import type { RecommendationFeature, RecommendationScore, Restaurant } from "@/lib/restaurant-types";

type ScoreOptions = { allRestaurants: Restaurant[]; labeledCount: number };
type FeatureInput = { key: string; label: string; value: number | null; weight: number; source: RecommendationFeature["source"]; note: string };

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
  const profileLambda = options.labeledCount < 30 ? 0 : Math.min(0.25, options.labeledCount < 50 ? 0.05 : options.labeledCount < 100 ? 0.1 : 0.15);
  const raw = clamp(base + profileLambda * 0 - 0.3 * risk, 0, 1);
  const confidence = clamp(0.3 * (restaurant.dataCompleteness / 100) + 0.5 * weightSum + 0.2 * (1 - uncertainty), 0, 1);
  const score = Math.round(50 + confidence * (100 * raw - 50));
  const features: RecommendationFeature[] = featuresInput.map((feature) => ({
    ...feature,
    contribution: feature.value === null || weightSum === 0 ? 0 : Number(((feature.weight / weightSum) * (feature.value - 0.5) * 100).toFixed(2)),
  }));
  return {
    score: clamp(score, 0, 100), confidence, risk,
    features,
    missingFeatures: features.filter((feature) => feature.value === null).map((feature) => feature.label),
    formulaVersion: "v4-rule-1",
  };
}

export function withRecommendationScores(restaurants: Restaurant[], labeledCount: number) {
  return restaurants.map((restaurant) => ({ ...restaurant, recommendation: calculateRecommendationScore(restaurant, { allRestaurants: restaurants, labeledCount }) }));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
