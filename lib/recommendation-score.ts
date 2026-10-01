import type { RecommendationFeature, RecommendationScore, Restaurant } from "@/lib/restaurant-types";

type ScoreOptions = { allRestaurants: Restaurant[]; preferenceSamples: PreferenceSample[]; learnedWeights?: DimensionWeights };
type FeatureInput = { key: string; label: string; value: number | null; weight: number; source: RecommendationFeature["source"]; note: string };

export type PreferenceFeedback = "want" | "not_interested" | "liked" | "average";
type PreferenceRestaurant = Pick<Restaurant, "id" | "name" | "category" | "type" | "averageCost" | "businessArea" | "longitude" | "latitude">;
export type PreferenceSample = {
  restaurant: PreferenceRestaurant;
  feedback?: PreferenceFeedback;
  labels?: string[];
  reasons?: string[];
};

type PreferenceDimension = "cuisine" | "price" | "area";
type DimensionWeights = Record<PreferenceDimension, number>;
const PRIOR_WEIGHTS: DimensionWeights = { cuisine: 0.6, price: 0.25, area: 0.15 };
const CUISINE_CUES = ["火锅", "川菜", "家常菜", "米线", "酸辣粉", "面", "烧烤", "烤串", "豆花", "新疆", "抓饭", "羊肉", "臭豆腐", "汉堡", "蛋烘糕", "春卷", "凉菜", "卤菜", "甜品", "小吃"];

function cuisineCues(restaurant: PreferenceRestaurant): Set<string> {
  const text = `${restaurant.name} ${restaurant.category} ${restaurant.type}`;
  return new Set(CUISINE_CUES.filter((cue) => text.includes(cue)));
}

function matchesDimension(a: PreferenceRestaurant, b: PreferenceRestaurant, dimension: PreferenceDimension): boolean {
  if (dimension === "cuisine") {
    const aCues = cuisineCues(a);
    return [...cuisineCues(b)].some((cue) => aCues.has(cue));
  }
  if (dimension === "price") return priceBand(a.averageCost) !== null && priceBand(a.averageCost) === priceBand(b.averageCost);
  return Boolean(a.businessArea && b.businessArea && a.businessArea === b.businessArea && nearbyArea(a, b));
}

function sampleSignal(sample: PreferenceSample, dimension: PreferenceDimension): number {
  if (sample.labels?.includes("blacklist")) {
    const reasons = new Set(sample.reasons ?? []);
    if (dimension === "cuisine" && reasons.has("not_fit")) return -0.65;
    if (dimension === "cuisine" && reasons.has("low_value")) return -0.4;
    if (dimension === "price" && reasons.has("expensive")) return -0.65;
    if (dimension === "area" && reasons.has("environment")) return -0.65;
    // Poor reputation, closed shops, duplicates and incorrect records identify
    // a particular POI; they must not teach a cuisine/price/area preference.
    return 0;
  }
  if (sample.feedback === "liked") return 1;
  if (sample.feedback === "average") return -0.7;
  if (sample.feedback === "not_interested") return -0.5;
  if (sample.feedback === "want") return 0.35;
  return sample.labels?.includes("want") ? 0.35 : 0;
}

function priceBand(cost: number | null): number | null {
  return cost !== null && Number.isFinite(cost) && cost > 0 ? Math.floor(Math.log2(cost / 25)) : null;
}

function nearbyArea(a: PreferenceRestaurant, b: PreferenceRestaurant): boolean {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) return false;
  const latitudeMeters = (a.latitude - b.latitude) * 111_000;
  const longitudeMeters = (a.longitude - b.longitude) * 111_000 * Math.cos(a.latitude * Math.PI / 180);
  return Math.hypot(latitudeMeters, longitudeMeters) <= 20_000;
}

export function trainPreferenceWeights(samples: PreferenceSample[], allRestaurants: Restaurant[]): DimensionWeights {
  const liked = samples.filter((sample) => sample.feedback === "liked" && !sample.labels?.includes("blacklist"));
  if (liked.length < 2 || allRestaurants.length < 5) return { ...PRIOR_WEIGHTS };
  const background = allRestaurants.filter((restaurant) => !liked.some((sample) => sample.restaurant.id === restaurant.id));
  const dimensions: PreferenceDimension[] = ["cuisine", "price", "area"];
  const raw = Object.fromEntries(dimensions.map((dimension) => {
    let positiveMatches = 0;
    let positivePairs = 0;
    for (let i = 0; i < liked.length; i++) for (let j = i + 1; j < liked.length; j++) {
      positivePairs++;
      if (matchesDimension(liked[i].restaurant, liked[j].restaurant, dimension)) positiveMatches++;
    }
    let backgroundMatches = 0;
    let backgroundPairs = 0;
    for (const sample of liked) for (const restaurant of background) {
      backgroundPairs++;
      if (matchesDimension(sample.restaurant, restaurant, dimension)) backgroundMatches++;
    }
    const positiveRate = positivePairs ? positiveMatches / positivePairs : 0;
    const backgroundRate = backgroundPairs ? backgroundMatches / backgroundPairs : 0;
    // A prior and a narrow lift range prevent a small or one-city album from
    // overwhelming the V4 anti-platform base score.
    const lift = clamp((positiveRate + 0.2) / (backgroundRate + 0.2), 0.75, 1.25);
    return [dimension, PRIOR_WEIGHTS[dimension] * lift];
  })) as DimensionWeights;
  const total = dimensions.reduce((sum, dimension) => sum + raw[dimension], 0);
  return Object.fromEntries(dimensions.map((dimension) => [dimension, raw[dimension] / total])) as DimensionWeights;
}

function personalEvidence(restaurant: Restaurant, samples: PreferenceSample[], weights: DimensionWeights) {
  const dimensions = [
    { key: "cuisine" as const, label: "口味/菜系偏好" },
    { key: "price" as const, label: "相近人均消费偏好" },
    { key: "area" as const, label: "同商圈偏好" },
  ];
  const matchedEvidence = dimensions.map((dimension) => {
    const matched = samples.filter((sample) => sample.restaurant.id !== restaurant.id && matchesDimension(restaurant, sample.restaurant, dimension.key))
      .map((sample) => sampleSignal(sample, dimension.key)).filter((signal) => signal !== 0);
    const sum = matched.reduce((total, signal) => total + signal, 0);
    const adjustment = 4 * weights[dimension.key] * sum / (matched.length + 3);
    return { label: dimension.label, adjustment: Number(adjustment.toFixed(1)), sampleCount: matched.length };
  }).filter((item) => item.sampleCount > 0);
  if (samples.some((sample) => sample.restaurant.id === restaurant.id && sample.feedback === "liked" && !sample.labels?.includes("blacklist"))) {
    matchedEvidence.unshift({ label: "已吃过且好吃（本店）", adjustment: 2.5, sampleCount: 1 });
  }
  return matchedEvidence;
}

const BASE_WEIGHTS = {
  food: 0.28, repeat: 0.18, years: 0.14, value: 0.12, exposure: 0.12, gap: 0.10, amap: 0.06,
};

export function calculateRecommendationScore(restaurant: Restaurant, options: ScoreOptions): RecommendationScore {
  const categoryRestaurants = options.allRestaurants.filter((item) => item.category === restaurant.category);
  const medianCost = median(categoryRestaurants.map((item) => item.averageCost).filter((value): value is number => value !== null));
  const featuresInput: FeatureInput[] = [
    { key: "food", label: "菜品口碑证据", value: null, weight: BASE_WEIGHTS.food, source: "amap", note: "当前高德接口未返回菜品分或评论正文" },
    { key: "repeat", label: "本地客/回头客证据", value: null, weight: BASE_WEIGHTS.repeat, source: "user", note: "尚未采集可验证的回头客信号" },
    { key: "years", label: "经营年限", value: null, weight: BASE_WEIGHTS.years, source: "amap", note: "当前数据没有经营年限" },
    { key: "value", label: "性价比", value: medianCost && restaurant.averageCost !== null && categoryRestaurants.length >= 5
      ? clamp(1 - restaurant.averageCost / (2 * medianCost), 0, 1) : null, weight: BASE_WEIGHTS.value, source: "derived", note: medianCost ? `同分类样本 ${categoryRestaurants.length} 家` : "同分类样本不足或缺少人均消费" },
    { key: "exposure", label: "低曝光但有证据", value: null, weight: BASE_WEIGHTS.exposure, source: "derived", note: "当前接口未返回可靠评论数量" },
    { key: "gap", label: "菜品分相对平台总分优势", value: null, weight: BASE_WEIGHTS.gap, source: "amap", note: "当前接口未返回菜品分" },
    { key: "amap", label: "高德评分证据", value: restaurant.rating === null ? null : clamp((restaurant.rating - 3) / 1.7, 0, 1), weight: BASE_WEIGHTS.amap, source: "amap", note: restaurant.rating === null ? "高德暂未返回评分" : "高德真实评分，仅占基础权重 6%" },
  ];
  const available = featuresInput.filter((feature) => feature.value !== null);
  const weightSum = available.reduce((sum, feature) => sum + feature.weight, 0);
  const normalizedBase = weightSum > 0 ? available.reduce((sum, feature) => sum + feature.weight * (feature.value ?? 0), 0) / weightSum : 0.5;
  // Keep the V1 anti-platform behavior: missing evidence stays neutral and the
  // available evidence cannot act as if all other feature groups were known.
  const base = weightSum > 0 ? 0.5 + (normalizedBase - 0.5) * weightSum : 0.5;
  const uncertainty = clamp(1 - restaurant.dataCompleteness / 100, 0, 1);
  const risk = uncertainty * 0.1;
  const raw = clamp(base - 0.3 * risk, 0, 1);
  const confidence = clamp(0.3 * (restaurant.dataCompleteness / 100) + 0.5 * weightSum + 0.2 * (1 - uncertainty), 0, 1);
  const baseScore = Math.round(50 + confidence * (100 * raw - 50));
  const weights = options.learnedWeights ?? trainPreferenceWeights(options.preferenceSamples, options.allRestaurants);
  const evidence = personalEvidence(restaurant, options.preferenceSamples, weights);
  const personalAdjustment = Number(clamp(evidence.reduce((sum, item) => sum + item.adjustment, 0), -4, 5.5).toFixed(1));
  const score = Math.round(clamp(baseScore + personalAdjustment, 0, 100));
  const features: RecommendationFeature[] = featuresInput.map((feature) => ({
    ...feature,
    contribution: feature.value === null || weightSum === 0 ? 0 : Number(((feature.weight / weightSum) * (feature.value - 0.5) * 100).toFixed(2)),
  }));
  return {
    score, baseScore, personalAdjustment, personalEvidence: evidence, confidence, risk,
    features,
    missingFeatures: features.filter((feature) => feature.value === null).map((feature) => feature.label),
    formulaVersion: "v6-album-learning-1",
  };
}

export function withRecommendationScores(restaurants: Restaurant[], preferenceSamples: PreferenceSample[]) {
  const learnedWeights = trainPreferenceWeights(preferenceSamples, restaurants);
  return restaurants.map((restaurant) => ({ ...restaurant, recommendation: calculateRecommendationScore(restaurant, { allRestaurants: restaurants, preferenceSamples, learnedWeights }) }));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
