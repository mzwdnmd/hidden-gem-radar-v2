"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Ban, Camera, Clock3, Columns3, Compass, Database, Download, ExternalLink,
  FileText, Heart, Info, LayoutList, LoaderCircle, Map as MapIcon, MapPin, MessageSquare, Upload,
  RefreshCw, Search, ShieldCheck, Sparkles, Star, Tag, ThumbsDown, Utensils, X,
} from "lucide-react";
import { toast } from "sonner";

import { RealMap } from "@/components/real-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import type { BrandBlacklistEntry, FilterReason, MapViewport, Restaurant, RestaurantSearchError, RestaurantSearchResponse, RestaurantStatus, V4RestaurantLabel } from "@/lib/restaurant-types";
import { extractCanonicalBrand, makeBrandEntry, normalizeRestaurantName } from "@/lib/brand-normalizer";
import { filterReasonLabels, getFilterReason, matchesAverageCost } from "@/lib/restaurant-filter";
import { withRecommendationScores, type PreferenceSample } from "@/lib/recommendation-score";
import { PUBLIC_CHAIN_BRANDS } from "@/lib/public-brand-blacklist";
import { loadReviewCaptures, loadReviewScreenshot, saveReviewCapture, type ReviewCapture } from "@/lib/review-capture-storage";
import { loadV4State, saveV4State } from "@/lib/v4-storage";
import { searchCity, searchFeatures, searchRestaurants, searchShops } from "@/lib/amap-browser-service";
import { exportPortableBackup, importPortableBackup } from "@/lib/portable-backup";
import { TRAINING_ALBUM, TRAINING_ALBUM_MATCHED_IDS, TRAINING_ALBUM_URL, trainingAlbumSamples } from "@/lib/training-album";

type Feedback = "want" | "not_interested" | "liked" | "average";
type LabelType = "want" | "blacklist" | "chain";
type ViewMode = "map" | "list" | "split";
type LabelReason = "low_value" | "poor_reputation" | "environment" | "expensive" | "wrong_info" | "closed" | "not_fit" | "duplicate" | "other";
type MapCenter = { longitude: number; latitude: number };
type UserLabel = {
  restaurant: Restaurant;
  labels: V4RestaurantLabel["labels"];
  reasons: LabelReason[];
  note: string;
  updatedAt: string;
  canonicalBrand?: string | null;
};
type PendingChainLabel = { restaurant: Restaurant; suggestedBrand: string };
type EnvironmentFeatures = {
  address: string | null;
  district: string | null;
  township: string | null;
  roads: Array<{ name: string; distanceMeters: number | null }>;
  roadIntersections: Array<{ name: string; distanceMeters: number | null }>;
  aois: Array<{ name: string; type: string | null; area: number | null; distanceMeters: number | null }>;
  nearby: Array<{ key: string; label: string; count: number; nearestDistanceMeters: number | null }>;
  fetchedAt: string;
  note: string;
};

const MAP_KEY = process.env.NEXT_PUBLIC_AMAP_JS_KEY?.trim() ?? "";
const MAP_SECURITY_CODE = process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE?.trim() ?? "";
const PAGES_MODE = process.env.NEXT_PUBLIC_PAGES_MODE === "1";

const statusMeta: Record<RestaurantStatus, { label: string; className: string }> = {
  high: { label: "高德 ≥4.6", className: "status-high" },
  potential: { label: "高德 4.0–4.5", className: "status-potential" },
  explore: { label: "高德 <4.0", className: "status-explore" },
};

const feedbackLabels: Record<Feedback, string> = {
  want: "想去", not_interested: "不感兴趣", liked: "吃过且好吃", average: "吃过但一般",
};
const labelReasonLabels: Record<LabelReason, string> = {
  low_value: "低价值目标", poor_reputation: "评分或口碑问题", environment: "环境问题",
  expensive: "价格不合适", wrong_info: "信息错误", closed: "店铺已关闭",
  not_fit: "不符合小馆定位", duplicate: "重复 POI", other: "其他",
};

function costBound(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(10000, Math.round(value))) : null;
}

export default function Home() {
  const backupInputRef = useRef<HTMLInputElement>(null);
  const shopLookupModeRef = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [center, setCenter] = useState<MapCenter | null>(null);
  const [searchCenter, setSearchCenter] = useState<MapCenter | null>(null);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [searchViewport, setSearchViewport] = useState<MapViewport | null>(null);
  const [searchPlan, setSearchPlan] = useState<RestaurantSearchResponse["searchPlan"]>(undefined);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [cityLoading, setCityLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [shopLookup, setShopLookup] = useState<{ keyword: string; city: string; restaurants: Restaurant[] } | null>(null);
  const [shopLookupLoading, setShopLookupLoading] = useState(false);
  const [category, setCategory] = useState("all");
  const [layer, setLayer] = useState<"all" | RestaurantStatus>("all");
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [feedbackSnapshots, setFeedbackSnapshots] = useState<Record<string, Restaurant>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RestaurantSearchError | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [labels, setLabels] = useState<Record<string, UserLabel>>({});
  const [showFiltered, setShowFiltered] = useState(false);
  const [brandBlacklist, setBrandBlacklist] = useState<BrandBlacklistEntry[]>([]);
  const [entertainmentWhitelist, setEntertainmentWhitelist] = useState<string[]>([]);
  const [densityEnabled, setDensityEnabled] = useState(true);
  const [densityStats, setDensityStats] = useState({ total: 0, displayed: 0 });
  const [pendingChain, setPendingChain] = useState<PendingChainLabel | null>(null);
  const [labelReason, setLabelReason] = useState<LabelReason>("low_value");
  const [labelNote, setLabelNote] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentFeatures | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [externalLinks, setExternalLinks] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [minCandidateScore, setMinCandidateScore] = useState(0);
  const [minAverageCost, setMinAverageCost] = useState<number | null>(null);
  const [maxAverageCost, setMaxAverageCost] = useState<number | null>(null);
  const [includeUnknownCost, setIncludeUnknownCost] = useState(false);
  const [reviewCaptures, setReviewCaptures] = useState<ReviewCapture[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [reviewScreenshot, setReviewScreenshot] = useState<File | null>(null);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("hidden-gem-v2-feedback");
    if (!stored) return;
    try { queueMicrotask(() => setFeedback(JSON.parse(stored))); }
    catch { window.localStorage.removeItem("hidden-gem-v2-feedback"); }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("hidden-gem-v6-feedback-snapshots");
    if (!stored) return;
    try { queueMicrotask(() => setFeedbackSnapshots(JSON.parse(stored) as Record<string, Restaurant>)); }
    catch { window.localStorage.removeItem("hidden-gem-v6-feedback-snapshots"); }
  }, []);

  useEffect(() => {
    const missing = restaurants.filter((restaurant) => feedback[restaurant.id] && !feedbackSnapshots[restaurant.id]);
    if (!missing.length) return;
    const next = { ...feedbackSnapshots, ...Object.fromEntries(missing.map((restaurant) => [restaurant.id, restaurant])) };
    window.localStorage.setItem("hidden-gem-v6-feedback-snapshots", JSON.stringify(next));
    queueMicrotask(() => setFeedbackSnapshots(next));
  }, [feedback, feedbackSnapshots, restaurants]);

  useEffect(() => {
    const state = loadV4State();
    const nextLabels = Object.fromEntries(Object.entries(state.restaurantLabels).map(([id, item]) => [id, {
      restaurant: item.restaurantSnapshot,
      labels: item.labels,
      reasons: item.reasons as LabelReason[], note: item.note, updatedAt: item.updatedAt,
      canonicalBrand: item.canonicalBrand,
    }]));
    queueMicrotask(() => {
      setLabels(nextLabels);
      setBrandBlacklist(state.brandBlacklist);
      setEntertainmentWhitelist(state.entertainmentWhitelist);
      setShowFiltered(state.settings.showFiltered);
      setDensityEnabled(state.settings.densityEnabled);
    });
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("hidden-gem-v3-external-links");
    if (!stored) return;
    try { queueMicrotask(() => setExternalLinks(JSON.parse(stored) as Record<string, string>)); }
    catch { window.localStorage.removeItem("hidden-gem-v3-external-links"); }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("hidden-gem-v5-ui-settings");
    let nextViewMode: ViewMode = "map";
    let nextMinimum = 0;
    let nextMinAverageCost: number | null = null;
    let nextMaxAverageCost: number | null = null;
    let nextIncludeUnknownCost = false;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { viewMode?: ViewMode; minCandidateScore?: number; minAverageCost?: number | null; maxAverageCost?: number | null; includeUnknownCost?: boolean };
        if (["map", "list", "split"].includes(parsed.viewMode ?? "")) nextViewMode = parsed.viewMode as ViewMode;
        if (Number.isFinite(parsed.minCandidateScore)) nextMinimum = Math.max(0, Math.min(100, Number(parsed.minCandidateScore)));
        nextMinAverageCost = costBound(parsed.minAverageCost);
        nextMaxAverageCost = costBound(parsed.maxAverageCost);
        nextIncludeUnknownCost = parsed.includeUnknownCost === true;
      } catch { window.localStorage.removeItem("hidden-gem-v5-ui-settings"); }
    }
    queueMicrotask(() => {
      setViewMode(nextViewMode);
      setMinCandidateScore(nextMinimum);
      setMinAverageCost(nextMinAverageCost);
      setMaxAverageCost(nextMaxAverageCost);
      setIncludeUnknownCost(nextIncludeUnknownCost);
      setReviewCaptures(loadReviewCaptures());
    });
  }, []);

  useEffect(() => () => {
    if (reviewPreviewUrl) URL.revokeObjectURL(reviewPreviewUrl);
  }, [reviewPreviewUrl]);

  useEffect(() => {
    if (!searchCenter) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        lng: searchCenter.longitude.toFixed(6), lat: searchCenter.latitude.toFixed(6), radius: "3000",
      });
      if (searchViewport) {
        params.set("zoom", searchViewport.zoom.toFixed(2));
        params.set("west", searchViewport.bounds.west.toFixed(6));
        params.set("south", searchViewport.bounds.south.toFixed(6));
        params.set("east", searchViewport.bounds.east.toFixed(6));
        params.set("north", searchViewport.bounds.north.toFixed(6));
      }
      if (activeQuery.trim()) params.set("keywords", activeQuery.trim());

      try {
        const payload = PAGES_MODE
          ? await searchRestaurants({ key: MAP_KEY, securityCode: MAP_SECURITY_CODE, center: searchCenter,
            viewport: searchViewport, keywords: activeQuery, signal: controller.signal })
          : await (async () => {
            const response = await fetch(`/api/restaurants?${params}`, {
              signal: controller.signal, headers: { Accept: "application/json" },
            });
            return await response.json() as RestaurantSearchResponse | RestaurantSearchError;
          })();
        if (shopLookupModeRef.current) return;
        if ("error" in payload) {
          setRestaurants([]);
          setSelectedId(null);
          setError("error" in payload ? payload : { error: "真实餐馆接口返回异常。", code: "UPSTREAM_ERROR" });
          return;
        }
        setRestaurants(payload.restaurants);
        setSearchPlan(payload.searchPlan);
        setLastFetchedAt(payload.fetchedAt);
        setSelectedId((current) => payload.restaurants.some((item) => item.id === current)
          ? current : payload.restaurants[0]?.id ?? null);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (shopLookupModeRef.current) return;
        setRestaurants([]);
        setSelectedId(null);
        setError({ error: requestError instanceof Error ? requestError.message : "无法读取真实餐馆数据，请检查网络连接。", code: "UPSTREAM_ERROR" });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchCenter, searchViewport, activeQuery, refreshToken]);

  const restaurantPool = shopLookup?.restaurants ?? restaurants;
  const categories = useMemo(
    () => Array.from(new Set(restaurantPool.map((item) => item.category))).sort(),
    [restaurantPool],
  );
  const preferenceSamples = useMemo(() => {
    const currentRestaurants = new Map(restaurantPool.map((restaurant) => [restaurant.id, restaurant]));
    const ids = new Set([...Object.keys(labels), ...Object.keys(feedback)]);
    const userSamples = [...ids].flatMap((id): PreferenceSample[] => {
      const restaurant = currentRestaurants.get(id) ?? feedbackSnapshots[id] ?? labels[id]?.restaurant;
      const legacyFeedback = labels[id]?.labels.includes("liked") ? "liked" : labels[id]?.labels.includes("average") ? "average" : undefined;
      return restaurant ? [{ restaurant, feedback: feedback[id] ?? legacyFeedback, labels: labels[id]?.labels, reasons: labels[id]?.reasons }] : [];
    });
    const blockedIds = new Set(Object.entries(labels).filter(([, value]) => value.labels.includes("blacklist") || value.labels.includes("chain")).map(([id]) => id));
    const explicitFeedback = { ...Object.fromEntries(Object.entries(labels).filter(([, value]) =>
      value.labels.some((label) => ["liked", "average", "not_interested", "want"].includes(label))).map(([id]) => [id, "legacy"])), ...feedback };
    return [...userSamples, ...trainingAlbumSamples(explicitFeedback, blockedIds)];
  }, [feedback, feedbackSnapshots, labels, restaurantPool]);
  const scoredRestaurants = useMemo(() => withRecommendationScores(restaurantPool, preferenceSamples), [preferenceSamples, restaurantPool]);
  const filterContext = useMemo(() => ({
    blacklistedIds: new Set(Object.entries(labels).filter(([, value]) => value.labels.includes("blacklist")).map(([id]) => id)),
    brandBlacklist,
    entertainmentWhitelist: new Set(entertainmentWhitelist),
  }), [brandBlacklist, entertainmentWhitelist, labels]);
  const filterReasons = useMemo(() => new Map(scoredRestaurants.map((restaurant) => [restaurant.id, getFilterReason(restaurant, filterContext)])), [filterContext, scoredRestaurants]);
  const costRangeInvalid = minAverageCost !== null && maxAverageCost !== null && minAverageCost > maxAverageCost;
  const costRangeActive = minAverageCost !== null || maxAverageCost !== null;
  const visibleRestaurants = useMemo(() => scoredRestaurants.filter((restaurant) => {
    if (shopLookup) return true; // Direct lookup must remain usable for labeling even when a candidate is screened.
    const categoryMatches = category === "all" || restaurant.category === category;
    const layerMatches = layer === "all" || restaurant.status === layer;
    const scoreMatches = (restaurant.recommendation?.score ?? 0) >= minCandidateScore;
    const costMatches = matchesAverageCost(restaurant.averageCost, {
      minimum: minAverageCost, maximum: maxAverageCost, includeUnknown: includeUnknownCost,
    });
    const filterReason = filterReasons.get(restaurant.id);
    return categoryMatches && layerMatches && scoreMatches && costMatches && (showFiltered || !filterReason);
  }).sort((a, b) => shopLookup ? 0 : (b.recommendation?.score ?? 0) - (a.recommendation?.score ?? 0) || (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name)), [category, filterReasons, includeUnknownCost, layer, maxAverageCost, minAverageCost, minCandidateScore, scoredRestaurants, shopLookup, showFiltered]);

  const selected = visibleRestaurants.find((restaurant) => restaurant.id === selectedId)
    ?? visibleRestaurants[0] ?? null;
  const selectedRestaurantId = selected?.id ?? null;
  const filteredByScoreCount = shopLookup ? 0 : scoredRestaurants.filter((restaurant) => (restaurant.recommendation?.score ?? 0) < minCandidateScore).length;
  const selectedReviewCaptures = selected ? reviewCaptures.filter((capture) => capture.restaurantId === selected.id) : [];
  const selectedAlbumEntry = selected ? TRAINING_ALBUM.find((entry) => entry.amapId === selected.id) : null;
  const selectedFeedback = selected && (feedback[selected.id] ?? (selectedAlbumEntry && !labels[selected.id]?.labels.includes("blacklist") ? "liked" : undefined));

  useEffect(() => {
    queueMicrotask(() => {
      setExternalUrl(selectedRestaurantId ? externalLinks[selectedRestaurantId] ?? "" : "");
      setReviewText("");
      setReviewScreenshot(null);
      setReviewPreviewUrl(null);
    });
  }, [externalLinks, selectedRestaurantId]);

  function saveFeedback(id: string, value: Feedback) {
    setFeedback((current) => {
      const next = { ...current, [id]: value };
      window.localStorage.setItem("hidden-gem-v2-feedback", JSON.stringify(next));
      return next;
    });
    const restaurant = restaurantPool.find((item) => item.id === id);
    if (restaurant) setFeedbackSnapshots((current) => {
      const next = { ...current, [id]: restaurant };
      window.localStorage.setItem("hidden-gem-v6-feedback-snapshots", JSON.stringify(next));
      return next;
    });
    toast.success(`已记录：${restaurant?.name ?? "这家店"} · ${feedbackLabels[value]}`);
  }

  function clearFeedback(id: string) {
    setFeedback((current) => {
      const next = { ...current };
      delete next[id];
      window.localStorage.setItem("hidden-gem-v2-feedback", JSON.stringify(next));
      return next;
    });
    toast.success("已撤销这条偏好记录");
  }

  function persistV4(nextLabels: Record<string, UserLabel>, nextBrands = brandBlacklist, nextWhitelist = entertainmentWhitelist) {
    const restaurantLabels = Object.fromEntries(Object.entries(nextLabels).map(([id, item]) => [id, {
      restaurantId: id,
      provider: "amap" as const,
      originalName: item.restaurant.name,
      normalizedName: normalizeRestaurantName(item.restaurant.name),
      canonicalBrand: item.canonicalBrand ?? null,
      labels: item.labels,
      reasons: item.reasons,
      note: item.note,
      restaurantSnapshot: item.restaurant,
      createdAt: item.updatedAt,
      updatedAt: item.updatedAt,
    }]));
    saveV4State({ version: 1, restaurantLabels, brandBlacklist: nextBrands, entertainmentWhitelist: nextWhitelist, settings: { showFiltered, densityEnabled } });
  }

  function saveLabel(restaurant: Restaurant, type: LabelType) {
    const existing = labels[restaurant.id] ?? { restaurant, labels: [], reasons: [], note: "", updatedAt: "" };
    const hasLabel = existing.labels.includes(type);
    if (type === "chain" && !hasLabel) {
      setPendingChain({ restaurant, suggestedBrand: extractCanonicalBrand(restaurant.name) });
      return;
    }
    commitLabel(restaurant, type, existing.canonicalBrand ?? null);
  }

  function commitLabel(restaurant: Restaurant, type: LabelType, forcedBrand: string | null) {
    const existing = labels[restaurant.id] ?? { restaurant, labels: [], reasons: [], note: "", updatedAt: "" };
    const hasLabel = existing.labels.includes(type);
    const canonicalBrand = forcedBrand;
    let nextBrands = brandBlacklist;
    if (type === "chain" && !hasLabel) {
      if (!canonicalBrand) { toast.error("品牌主体不能为空"); return; }
      const existingBrand = brandBlacklist.find((entry) => entry.canonicalName === canonicalBrand);
      if (existingBrand) {
        nextBrands = brandBlacklist.map((entry) => entry.id === existingBrand.id ? {
          ...entry,
          sourceRestaurantIds: Array.from(new Set([...entry.sourceRestaurantIds, restaurant.id])),
          sourceNames: Array.from(new Set([...entry.sourceNames, restaurant.name])),
          updatedAt: new Date().toISOString(),
        } : entry);
      } else {
        const entry = makeBrandEntry(restaurant.name, restaurant.id);
        nextBrands = [...brandBlacklist, { ...entry, canonicalName: canonicalBrand, sourceNames: [restaurant.name] }];
      }
      setBrandBlacklist(nextBrands);
    }
    const nextLabels = {
      ...labels,
      [restaurant.id]: {
        restaurant,
        labels: hasLabel ? existing.labels.filter((label) => label !== type) : [...existing.labels, type],
        reasons: type === "blacklist" && !hasLabel && !existing.reasons.includes(labelReason) ? [...existing.reasons, labelReason] : existing.reasons,
        note: labelNote.trim() || existing.note,
        canonicalBrand,
        updatedAt: new Date().toISOString(),
      },
    };
    setLabels(nextLabels);
    persistV4(nextLabels, nextBrands);
    toast.success(hasLabelMessage(existing.labels, type));
  }

  function confirmPendingChain() {
    if (!pendingChain) return;
    const canonicalBrand = extractCanonicalBrand(pendingChain.suggestedBrand);
    if (!canonicalBrand) { toast.error("品牌主体不能为空"); return; }
    const { restaurant } = pendingChain;
    setPendingChain(null);
    commitLabel(restaurant, "chain", canonicalBrand);
  }

  function removeBrandEntry(id: string) {
    const nextBrands = brandBlacklist.filter((entry) => entry.id !== id);
    setBrandBlacklist(nextBrands);
    persistV4(labels, nextBrands);
    toast.success("已解除该品牌的整体屏蔽");
  }

  function restoreAutomaticFilter(restaurant: Restaurant) {
    const nextWhitelist = Array.from(new Set([...entertainmentWhitelist, restaurant.id]));
    setEntertainmentWhitelist(nextWhitelist);
    persistV4(labels, brandBlacklist, nextWhitelist);
    toast.success("已恢复这家店，后续查询仍保留该 POI 白名单");
  }

  function hasLabelMessage(existing: V4RestaurantLabel["labels"], type: LabelType) {
    const hasLabel = existing.includes(type);
    const labels: Record<LabelType, string> = { want: "想去", blacklist: "黑名单", chain: "连锁店" };
    return `${hasLabel ? "已取消" : "已标记为"}${labels[type]}`;
  }

  function downloadAnnotations() {
    const payload = {
      version: "v5-labels-1",
      exportedAt: new Date().toISOString(),
      labels: Object.values(labels),
      brandBlacklist,
      entertainmentWhitelist,
      formulaVersion: "v6-album-learning-1",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hidden-gem-radar-v5-labels-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("标注数据已导出，可用于后续模型训练");
  }

  async function downloadFullBackup() {
    setBackupBusy(true);
    try {
      const result = await exportPortableBackup();
      toast.success(`完整备份已下载：${result.labels} 条标签、${result.reviews} 条评论、${result.images} 张截图`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "备份失败");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleBackupFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    try {
      const result = await importPortableBackup(file);
      toast.success(`已合并 ${result.labels} 条标签、${result.reviews} 条评论、${result.images} 张截图`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败，请检查文件格式");
      setBackupBusy(false);
    }
  }

  async function loadEnvironmentFeatures(restaurant: Restaurant) {
    setEnvironmentLoading(true);
    try {
      const params = new URLSearchParams({ lng: restaurant.longitude.toFixed(6), lat: restaurant.latitude.toFixed(6) });
      const payload = PAGES_MODE
        ? await searchFeatures(MAP_KEY, MAP_SECURITY_CODE, restaurant.longitude, restaurant.latitude)
        : await (async () => {
          const response = await fetch(`/api/features?${params}`, { headers: { Accept: "application/json" } });
          return await response.json() as EnvironmentFeatures | { error?: string };
        })();
      if (!("nearby" in payload)) {
        toast.error("环境特征暂时无法读取");
        return;
      }
      setEnvironment(payload);
    } catch {
      toast.error("环境特征请求失败，请稍后重试");
    } finally {
      setEnvironmentLoading(false);
    }
  }

  function saveExternalLink(id: string) {
    const value = externalUrl.trim();
    if (!value) return;
    try { new URL(value); } catch { toast.error("请输入有效链接"); return; }
    const stored = JSON.parse(window.localStorage.getItem("hidden-gem-v3-external-links") ?? "{}") as Record<string, string>;
    stored[id] = value;
    window.localStorage.setItem("hidden-gem-v3-external-links", JSON.stringify(stored));
    setExternalLinks(stored);
    toast.success("已保存外部商户链接");
  }

  function saveUiSettings(nextViewMode: ViewMode, nextMinimum: number, nextMinCost = minAverageCost, nextMaxCost = maxAverageCost, nextIncludeUnknownCost = includeUnknownCost) {
    window.localStorage.setItem("hidden-gem-v5-ui-settings", JSON.stringify({ viewMode: nextViewMode, minCandidateScore: nextMinimum,
      minAverageCost: nextMinCost, maxAverageCost: nextMaxCost, includeUnknownCost: nextIncludeUnknownCost }));
  }

  function changeViewMode(next: ViewMode) {
    setViewMode(next);
    saveUiSettings(next, minCandidateScore);
  }

  function changeMinimumScore(value: string) {
    const next = Math.max(0, Math.min(100, Number(value) || 0));
    setMinCandidateScore(next);
    saveUiSettings(viewMode, next);
  }

  function changeCostBound(which: "min" | "max", value: string) {
    const next = costBound(value === "" ? null : Number(value));
    if (which === "min") {
      setMinAverageCost(next);
      saveUiSettings(viewMode, minCandidateScore, next, maxAverageCost);
    } else {
      setMaxAverageCost(next);
      saveUiSettings(viewMode, minCandidateScore, minAverageCost, next);
    }
  }

  async function storeReviewCapture(restaurant: Restaurant) {
    const sourceUrl = (externalLinks[restaurant.id] ?? externalUrl).trim();
    const text = reviewText.trim();
    if (!sourceUrl) { toast.error("请先保存评论来源链接"); return; }
    if (!text) { toast.error("请填入截图识别出的评论文字"); return; }
    const capture: ReviewCapture = {
      id: `review-${restaurant.id}-${Date.now()}`,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      sourceUrl,
      text,
      screenshotName: reviewScreenshot?.name ?? null,
      capturedAt: new Date().toISOString(),
      confirmedByUser: true,
    };
    try {
      await saveReviewCapture(capture, reviewScreenshot);
      setReviewCaptures((current) => [capture, ...current]);
      setReviewText("");
      setReviewScreenshot(null);
      setReviewPreviewUrl(null);
      toast.success("评论证据已保存到本机");
    } catch {
      toast.error("评论证据保存失败，请检查浏览器存储权限");
    }
  }

  async function showReviewScreenshot(capture: ReviewCapture) {
    try {
      const screenshot = await loadReviewScreenshot(capture.id);
      if (!screenshot) { toast("这条记录没有保存截图"); return; }
      const url = URL.createObjectURL(screenshot);
      setReviewPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
    } catch {
      toast.error("截图读取失败");
    }
  }

  function searchArea() {
    if (!center) {
      toast("请先选择城市、定位或拖动地图");
      return;
    }
    const wasShopLookup = shopLookupModeRef.current;
    shopLookupModeRef.current = false;
    setShopLookup(null);
    setSearchCenter(center);
    setSearchViewport(viewport);
    if (wasShopLookup) setQuery("");
    setActiveQuery(wasShopLookup ? "" : query);
    setRefreshToken((value) => value + 1);
    toast("已提交当前可视全图搜索");
  }

  async function lookupShop(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (shopLookupLoading) return;
    const keyword = query.trim();
    if (!keyword) { toast("请输入店铺名称"); return; }
    setShopLookupLoading(true);
    try {
      const city = cityQuery.trim();
      const found = await searchShops({ key: MAP_KEY, securityCode: MAP_SECURITY_CODE, keyword, city, center });
      if (!found.length) {
        toast.error(`没有找到“${keyword}”的餐饮店铺；可尝试更完整的店名或调整城市`);
        return;
      }
      shopLookupModeRef.current = true;
      setError(null);
      setLocationAccuracy(null);
      setShopLookup({ keyword, city, restaurants: found });
      setSelectedId(found[0].id);
      setCenter({ longitude: found[0].longitude, latitude: found[0].latitude });
      setViewMode("split");
      toast.success(`找到 ${found.length} 家匹配店铺${city ? ` · ${city}` : " · 全国"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "店铺查找失败，请稍后重试");
    } finally {
      setShopLookupLoading(false);
    }
  }

  function chooseRestaurant(restaurant: Restaurant) {
    setSelectedId(restaurant.id);
    if (shopLookup) setCenter({ longitude: restaurant.longitude, latitude: restaurant.latitude });
  }

  function surpriseMe() {
    if (shopLookup) {
      toast("请先点击“返回地图候选”，再随机推荐");
      return;
    }
    const pool = visibleRestaurants;
    if (!pool.length) {
      toast("当前地图范围内没有可推荐的真实候选");
      return;
    }
    const next = pool[Math.floor(Math.random() * pool.length)];
    setSelectedId(next.id);
    toast(`今天去看看「${next.name}」`, { description: next.reasons.slice(0, 2).join(" · ") });
  }

  async function selectCity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = cityQuery.trim();
    if (!keyword) {
      toast("请输入城市名称");
      return;
    }
    setCityLoading(true);
    try {
      const payload: {
        error?: string;
        name?: string;
        center?: MapCenter;
      } = PAGES_MODE
        ? await searchCity(MAP_KEY, MAP_SECURITY_CODE, keyword)
        : await (async () => {
          const response = await fetch(`/api/cities?q=${encodeURIComponent(keyword)}`, { headers: { Accept: "application/json" } });
          return await response.json();
        })();
      if (!payload.center || !payload.name) {
        toast.error(payload.error ?? "没有找到该城市");
        return;
      }
      setLocationAccuracy(null);
      shopLookupModeRef.current = false;
      setShopLookup(null);
      setSelectedCity(payload.name);
      setCenter(payload.center);
      setSearchCenter(payload.center);
      setSearchViewport(viewport ? translateViewport(viewport, payload.center) : null);
      setActiveQuery(shopLookup ? "" : query);
      if (shopLookup) setQuery("");
      setRefreshToken((value) => value + 1);
      toast.success(`已切换到${payload.name}`);
    } catch {
      toast.error("城市查询失败，请检查网络连接");
    } finally {
      setCityLoading(false);
    }
  }

  function handleMapCenterChange(nextCenter: MapCenter) {
    setSelectedCity(null);
    setCenter(nextCenter);
  }

  const centerLabel = center ? `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}` : "正在定位";
  const viewportChanged = Boolean(viewport && searchViewport && (
    Math.abs(viewport.zoom - searchViewport.zoom) > 0.05
    || Math.abs(viewport.bounds.west - searchViewport.bounds.west) > 0.005
    || Math.abs(viewport.bounds.south - searchViewport.bounds.south) > 0.005
    || Math.abs(viewport.bounds.east - searchViewport.bounds.east) > 0.005
    || Math.abs(viewport.bounds.north - searchViewport.bounds.north) > 0.005
  ));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="小馆雷达 V5">
          <span className="brand-mark"><Utensils /></span>
          <span><b>小馆雷达 <em>V5</em></b><small>REVIEW-ASSISTED DISCOVERY</small></span>
        </div>
        <form className="search-box" onSubmit={lookupShop} aria-label="按城市查找店铺">
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入店名，查找当前地图外的餐馆" aria-label="输入要查找的店铺名称" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X /></button>}
          <button className="shop-search-submit" type="submit" disabled={shopLookupLoading}>{shopLookupLoading ? "查找中" : "搜店铺"}</button>
        </form>
        <div className="topbar-actions">
          <Button variant="outline" onClick={downloadAnnotations} className="export-button"><Download /> 导出标注</Button>
          <Button variant="outline" onClick={downloadFullBackup} disabled={backupBusy} className="export-button"><Download /> 完整备份</Button>
          <Button variant="outline" onClick={() => backupInputRef.current?.click()} disabled={backupBusy} className="export-button"><Upload /> 导入备份</Button>
          <input ref={backupInputRef} type="file" accept="application/json,.json" onChange={handleBackupFile} hidden aria-label="选择备份文件" />
          <Button onClick={surpriseMe} className="surprise-button"><Sparkles /> 今天带我去一家没那么火的</Button>
        </div>
      </header>

      <section className="workspace">
        <div className="map-pane">
          <div className="floating-filters" aria-label="地图筛选">
            <form className="city-search" onSubmit={selectCity}>
              <MapPin aria-hidden="true" />
              <input value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="输入城市" aria-label="输入想查看的城市" />
              <button type="submit" disabled={cityLoading}>{cityLoading ? "查询中" : "查看"}</button>
            </form>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="选择菜系"><SelectValue>{category === "all" ? "全部分类" : category}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {categories.map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="viewport-search-chip">随缩放覆盖全图{viewport ? ` · Z${viewport.zoom.toFixed(0)}` : ""}</span>
            <Button variant="outline" className="refresh-button" onClick={searchArea} disabled={loading || !center}>
              {loading ? <LoaderCircle className="spin" /> : <RefreshCw />}{shopLookup ? "返回地图候选" : "搜索此区域"}
            </Button>
            <Button variant="outline" className="refresh-button filtered-toggle" onClick={() => {
              const next = !showFiltered;
              setShowFiltered(next);
              saveV4State({ ...loadV4State(), settings: { showFiltered: next, densityEnabled } });
            }}>
              {showFiltered ? "隐藏已屏蔽" : "显示已屏蔽"}
            </Button>
            <Button variant="outline" className="refresh-button" onClick={() => {
              const next = !densityEnabled;
              setDensityEnabled(next);
              saveV4State({ ...loadV4State(), settings: { showFiltered, densityEnabled: next } });
            }}>
              {densityEnabled ? "均匀显示：开" : "均匀显示：关"}
            </Button>
            <label className="candidate-threshold">
              <span>最低候选分</span>
              <input type="number" min="0" max="100" step="1" value={minCandidateScore} onChange={(event) => changeMinimumScore(event.target.value)} aria-label="最低候选分" />
            </label>
            <details className="cost-range-filter">
              <summary>人均 {costRangeActive ? `¥${minAverageCost ?? 0}–${maxAverageCost ?? "不限"}` : "不限"}</summary>
              <div className="cost-range-panel">
                <b>自定义人均消费</b>
                <div className="cost-range-inputs">
                  <label>最低 ¥<input type="number" min="0" max="10000" step="1" value={minAverageCost ?? ""} placeholder="不限" onChange={(event) => changeCostBound("min", event.target.value)} aria-label="最低人均消费" /></label>
                  <span>—</span>
                  <label>最高 ¥<input type="number" min="0" max="10000" step="1" value={maxAverageCost ?? ""} placeholder="不限" onChange={(event) => changeCostBound("max", event.target.value)} aria-label="最高人均消费" /></label>
                </div>
                <label className="cost-unknown-toggle"><input type="checkbox" checked={includeUnknownCost} onChange={(event) => {
                  setIncludeUnknownCost(event.target.checked);
                  saveUiSettings(viewMode, minCandidateScore, minAverageCost, maxAverageCost, event.target.checked);
                }} />包含人均未知的店</label>
                {costRangeInvalid && <small role="alert">最低金额不能高于最高金额</small>}
                <button type="button" onClick={() => {
                  setMinAverageCost(null);
                  setMaxAverageCost(null);
                  saveUiSettings(viewMode, minCandidateScore, null, null);
                }}>清除区间</button>
              </div>
            </details>
            <div className="view-mode-switch" role="group" aria-label="结果展示方式">
              <button className={viewMode === "map" ? "active" : ""} onClick={() => changeViewMode("map")} aria-label="地图视图"><MapIcon /></button>
              <button className={viewMode === "list" ? "active" : ""} onClick={() => changeViewMode("list")} aria-label="列表视图"><LayoutList /></button>
              <button className={viewMode === "split" ? "active" : ""} onClick={() => changeViewMode("split")} aria-label="分屏视图"><Columns3 /></button>
            </div>
            {(viewportChanged || (center && searchCenter && (Math.abs(center.longitude - searchCenter.longitude) > 0.005 || Math.abs(center.latitude - searchCenter.latitude) > 0.005)))
              && <span className="pending-search-badge">区域已变化</span>}
          </div>

          <div className="map-stage">
            <RealMap apiKey={MAP_KEY} securityCode={MAP_SECURITY_CODE} center={center}
              restaurants={visibleRestaurants} selectedId={selected?.id ?? null} densityEnabled={densityEnabled}
              onDensityStats={setDensityStats}
              onCenterChange={handleMapCenterChange} onViewportChange={setViewport}
              onLocationAccuracy={setLocationAccuracy} onSelect={(id) => {
                const restaurant = visibleRestaurants.find((item) => item.id === id);
                if (restaurant) chooseRestaurant(restaurant);
              }} />
          </div>

          {viewMode !== "map" && <section className={`candidate-results-list ${viewMode}`} aria-label="当前搜索结果列表">
            <header><div><b>{shopLookup ? `店铺查找：${shopLookup.keyword}` : "当前搜索结果"}</b><span>{shopLookup ? `${visibleRestaurants.length} 家匹配 · 含已屏蔽店铺` : `${visibleRestaurants.length} 家可见 · ${filteredByScoreCount} 家低于门槛`}</span></div><small>{shopLookup ? "按店名匹配" : "按候选分排序"}</small></header>
            <div className="candidate-results-scroll">
              {visibleRestaurants.length ? visibleRestaurants.map((restaurant) => (
                <button key={restaurant.id} className={selected?.id === restaurant.id ? "active" : ""} onClick={() => chooseRestaurant(restaurant)}>
                  <strong>{restaurant.recommendation?.score ?? "–"}<small>候选分</small></strong>
                  <span><b>{restaurant.name}</b><small>{restaurant.category} · 高德 {restaurant.rating?.toFixed(1) ?? "暂无"} · {restaurant.averageCost ? `人均 ¥${Math.round(restaurant.averageCost)}` : "人均暂无"}</small><em>{restaurant.address ?? "地址暂未返回"}</em></span>
                </button>
              )) : <div className="candidate-list-empty">当前条件下没有候选，请降低最低候选分或调整筛选。</div>}
            </div>
          </section>}

          <div className="map-footer">
            <div className="layer-switch" role="group" aria-label="候选置信层级">
              {([['all', '全部'], ['high', '4.6–4.7'], ['potential', '4.0–4.5'], ['explore', '3.0–3.9 / 无评分']] as const).map(([value, label]) => (
                <button key={value} className={layer === value ? "active" : ""} onClick={() => setLayer(value)}>{label}</button>
              ))}
            </div>
            <p className="real-source-chip"><ShieldCheck /> {shopLookup ? `高德城市店铺查找 · ${shopLookup.city || "全国"} · 点击“搜索此区域”返回地图候选` : `高德真实 POI · 候选分 ≥ ${minCandidateScore} · ${costRangeActive ? `人均 ¥${minAverageCost ?? 0}–${maxAverageCost ?? "不限"} · ` : ""}${searchPlan ? `全图 ${searchPlan.gridColumns}×${searchPlan.gridRows} 网格${searchPlan.partial ? `（完成 ${searchPlan.completedQueries}/${searchPlan.queryCount}）` : ""} · ` : ""}地图显示 ${densityStats.displayed}/${densityStats.total}`}</p>
          </div>
        </div>

        <aside className="detail-pane">
          <div className="results-heading">
            <div><span className="eyebrow"><MapPin /> {shopLookup ? "所选店铺位置" : selectedCity ? `${selectedCity}中心` : "地图中心"} {centerLabel}{locationAccuracy ? ` · 精度约 ${Math.round(locationAccuracy)} m` : ""}</span><h1>{shopLookup ? `${visibleRestaurants.length} 家店铺匹配` : loading ? "正在读取真实餐馆…" : `${visibleRestaurants.length} 家真实候选`}</h1></div>
            <span className="real-data-badge"><Database /> 高德数据</span>
          </div>

          <details className="training-album-list">
            <summary><Star /> 吃过且好吃 · 训练用专辑 {TRAINING_ALBUM.length} 家 <small>{TRAINING_ALBUM_MATCHED_IDS.size} 家已核准高德门店</small></summary>
            <p>名单来自<a href={TRAINING_ALBUM_URL} target="_blank" rel="noreferrer">风谣分享的大众点评合集 <ExternalLink /></a>。4 家尚未核准跨平台门店，保留为口味样本，不做本店加分；你的本机标注优先。</p>
            <ol>{TRAINING_ALBUM.map((entry) => <li key={entry.dianpingId}>
              <span>{entry.name}</span><small>{entry.district} · {entry.cuisine} · {entry.amapId ? "门店已核准" : "待核准门店"}</small>
            </li>)}</ol>
          </details>

          {error ? (
            <SetupOrError error={error} hasMapKey={Boolean(MAP_KEY && MAP_SECURITY_CODE)} onRetry={() => setRefreshToken((value) => value + 1)} />
          ) : !center ? (
            <div className="empty-state"><Compass /><h2>等待精确位置</h2><p>请允许浏览器使用精确位置；若浏览器只能提供城市级定位，可拖动地图到目标区域。</p></div>
          ) : loading && !restaurantPool.length ? (
            <div className="empty-state"><LoaderCircle className="spin" /><h2>正在获取附近真实餐馆</h2><p>查询高德开放平台，请稍候。</p></div>
          ) : !searchCenter ? (
            <div className="empty-state"><Compass /><h2>等待搜索</h2><p>地图移动不会自动消耗额度，请点击“搜索此区域”获取真实 POI。</p></div>
          ) : !selected ? (
            <div className="empty-state"><Compass /><h2>当前范围没有可见餐馆</h2><p>可能命中了非餐馆、娱乐场所、黑名单或连锁店规则。可以打开“显示已屏蔽”检查。</p></div>
          ) : (
            <>
              <div className="shop-selector" aria-label="真实候选餐馆">
                {visibleRestaurants.map((restaurant) => (
                  <button key={restaurant.id} className={selected.id === restaurant.id ? "active" : ""} onClick={() => chooseRestaurant(restaurant)}>
                    <span>{restaurant.name}</span><b>{restaurant.recommendation?.score ?? "–"}<small>候选分</small></b>
                  </button>
                ))}
              </div>

              <article className="shop-detail">
                <div className="shop-title-row">
                  <div><Badge variant="outline" className={statusMeta[selected.status].className}>{selected.rating === null ? "高德暂无评分" : statusMeta[selected.status].label}</Badge>
                    <h2>{selected.name}</h2><p>{selected.category} · {formatDistance(selected.distanceMeters)}{selected.businessArea ? ` · ${selected.businessArea}` : ""}</p></div>
                  <div className="score-orbit" style={{ "--score": `${(selected.rating ?? 0) * 72}deg` } as React.CSSProperties}>
                    <strong>{selected.rating?.toFixed(1) ?? "–"}</strong><span>高德评分</span>
                  </div>
                </div>

                {selected.photos[0] && <div className="shop-photo real-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selected.photos[0].url} alt={selected.photos[0].title} /><span>图片来源：高德开放平台</span>
                </div>}

                <div className="reason-card"><Sparkles /><div><b>为什么进入候选</b><p>{selected.reasons.join(" · ")}</p></div></div>

                <section className="recommendation-card">
                  <div className="section-title"><h3><Sparkles /> 个性化候选分</h3><span>公式 v6-album-learning-1</span></div>
                  <div className="recommendation-score-row"><strong>{selected.recommendation?.score ?? "–"}</strong><span>基础数据置信度 {Math.round((selected.recommendation?.confidence ?? 0) * 100)}%</span></div>
                  <p>V4 基础分 {selected.recommendation?.baseScore ?? "–"}；偏好学习 {selected.recommendation?.personalAdjustment !== undefined ? `${selected.recommendation.personalAdjustment >= 0 ? "+" : ""}${selected.recommendation.personalAdjustment.toFixed(1)}` : "0"}。合集与本机“吃过且好吃”共同学习口味、人均和商圈权重；核准的喜欢门店额外 +2.5，总加分最多 +5.5。候选分不代表平台评分。</p>
                  {(selected.recommendation?.personalEvidence.length ?? 0) > 0
                    ? <div className="recommendation-features">{selected.recommendation?.personalEvidence.map((item) => <span key={item.label}>{item.label} {item.adjustment >= 0 ? "+" : ""}{item.adjustment.toFixed(1)}（{item.sampleCount} 条）</span>)}</div>
                    : <small>暂无可匹配的个人偏好样本；保持 V4 基础排序。</small>}
                  <div className="recommendation-features">
                    {(selected.recommendation?.features ?? []).filter((feature) => feature.value !== null).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3).map((feature) => (
                      <span key={feature.key}>{feature.label} {feature.contribution >= 0 ? "+" : ""}{feature.contribution.toFixed(1)}</span>
                    ))}
                  </div>
                  {!!selected.recommendation?.missingFeatures.length && <small>缺少证据：{selected.recommendation.missingFeatures.join("、")}</small>}
                </section>

                {filterReasons.get(selected.id) && <section className="filter-reason-card"><Info /><div><b>当前处于已屏蔽结果</b><p>{filterReasonLabels[filterReasons.get(selected.id) as FilterReason]}</p></div>
                  {["entertainment_name", "entertainment_type", "non_dining_name", "non_dining_type"].includes(filterReasons.get(selected.id) ?? "")
                    ? <Button size="sm" variant="outline" onClick={() => restoreAutomaticFilter(selected)}>恢复显示</Button>
                    : filterReasons.get(selected.id) === "chain_brand_blacklist"
                      ? <Button size="sm" variant="outline" onClick={() => {
                        const match = brandBlacklist.find((entry) => extractCanonicalBrand(selected.name) === extractCanonicalBrand(entry.canonicalName));
                        if (match) removeBrandEntry(match.id);
                      }}>解除品牌屏蔽</Button>
                      : null}
                </section>}

                <div className="metric-grid">
                  <div><span>高德评分</span><b>{selected.rating?.toFixed(1) ?? "暂无"}</b><small>平台真实返回值</small></div>
                  <div><span>人均消费</span><b>{selected.averageCost ? `¥${Math.round(selected.averageCost)}` : "暂无"}</b><small>仅展示来源数据</small></div>
                  <div><span>距离中心</span><b>{formatDistance(selected.distanceMeters)}</b><small>平台返回距离</small></div>
                  <div><span>资料完整度</span><b>{selected.dataCompleteness}%</b><small>仅表示返回字段是否齐全</small></div>
                </div>

                <section className="truth-section">
                  <div className="section-title"><h3><Clock3 /> 营业与联系</h3></div>
                  <dl>
                    <div><dt>营业时间</dt><dd>{selected.openingHours ?? "平台暂未返回"}</dd></div>
                    <div><dt>地址</dt><dd>{selected.address ?? "平台暂未返回"}</dd></div>
                    <div><dt>电话</dt><dd>{selected.telephone ?? "平台暂未返回"}</dd></div>
                    <div><dt>标签</dt><dd>{selected.tags.length ? selected.tags.join(" · ") : "平台暂未返回"}</dd></div>
                  </dl>
                </section>

                <section className="review-pending-card"><Info /><div><b>评论证据</b><p>{selectedReviewCaptures.length ? `已人工核对并保存 ${selectedReviewCaptures.length} 条评论证据，可在下方查看原文和截图。` : "高德当前接口未提供可靠评论正文；可以在下方人工登录外部页面，导入可见截图和识别文字。"}</p></div></section>

                <section className="provenance-card">
                  <Database /><div><b>数据来源与新鲜度</b><p>高德开放平台 POI ID：{selected.id}</p><small>查询时间：{formatTimestamp(lastFetchedAt ?? selected.fetchedAt)}</small></div>
                  <a href={amapMarkerUrl(selected)} target="_blank" rel="noreferrer">在高德查看 <ExternalLink /></a>
                </section>

                <section className="label-panel" aria-label="人工标注">
                  <div className="section-title"><h3><Tag /> 人工标注</h3><span>用于后续模型训练</span></div>
                  <div className="label-controls">
                    <label><span>黑名单原因</span><select value={labelReason} onChange={(event) => setLabelReason(event.target.value as LabelReason)}>
                      {Object.entries(labelReasonLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select></label>
                    <input value={labelNote} onChange={(event) => setLabelNote(event.target.value)} placeholder="补充备注（可选）" aria-label="标注备注" />
                  </div>
                  <div className="feedback-actions">
                    <Button variant={labels[selected.id]?.labels.includes("want") ? "default" : "outline"} onClick={() => saveLabel(selected, "want")}><Heart />想去</Button>
                    <Button variant={labels[selected.id]?.labels.includes("blacklist") ? "default" : "outline"} onClick={() => saveLabel(selected, "blacklist")}><Ban />黑名单</Button>
                    <Button variant={labels[selected.id]?.labels.includes("chain") ? "default" : "outline"} onClick={() => saveLabel(selected, "chain")}><Tag />连锁店</Button>
                  </div>
                  {pendingChain?.restaurant.id === selected.id && <div className="chain-confirm-card">
                    <b>确认整体屏蔽这个品牌</b>
                    <p>确认后，当前门店以及以后查询到的同品牌门店都会被屏蔽。</p>
                    <input value={pendingChain.suggestedBrand} onChange={(event) => setPendingChain({ ...pendingChain, suggestedBrand: event.target.value })} aria-label="品牌主体" />
                    <div className="feedback-actions"><Button size="sm" onClick={confirmPendingChain}>确认屏蔽品牌</Button><Button size="sm" variant="ghost" onClick={() => setPendingChain(null)}>取消</Button></div>
                  </div>}
                  {brandBlacklist.length > 0 && <div className="brand-blacklist-list"><b>我的已屏蔽品牌</b>{brandBlacklist.map((entry) => <div key={entry.id}><span>{entry.canonicalName}</span><small>{entry.sourceNames.length} 个来源门店</small><Button size="sm" variant="ghost" onClick={() => removeBrandEntry(entry.id)}>解除</Button></div>)}</div>}
                  <details className="public-brand-list"><summary>公共连锁屏蔽名单（{PUBLIC_CHAIN_BRANDS.length} 个）</summary><p>{PUBLIC_CHAIN_BRANDS.map((entry) => entry.name).join("、")}</p></details>
                </section>

                <div className="feedback-actions" aria-label="记录偏好">
                  <Button variant={feedback[selected.id] === "want" ? "default" : "outline"} onClick={() => saveFeedback(selected.id, "want")}><Heart />想去</Button>
                  <Button variant={selectedFeedback === "liked" ? "default" : "outline"} onClick={() => saveFeedback(selected.id, "liked")}><Star />吃过且好吃</Button>
                  <Button variant="ghost" onClick={() => saveFeedback(selected.id, "not_interested")}><X />不感兴趣</Button>
                  <Button variant="ghost" onClick={() => saveFeedback(selected.id, "average")}><ThumbsDown />吃过但一般</Button>
                </div>
                {feedback[selected.id] ? <p className="saved-feedback">已保存在本机：{feedbackLabels[feedback[selected.id]]} · <button type="button" onClick={() => clearFeedback(selected.id)}>撤销</button></p>
                  : selectedAlbumEntry && <p className="saved-feedback">来自训练用专辑：吃过且好吃 · 如有不同评价，可在上方改标。</p>}

                <section className="environment-card">
                  <div className="section-title"><h3><Compass /> 环境特征</h3><Button variant="outline" size="sm" onClick={() => loadEnvironmentFeatures(selected)} disabled={environmentLoading}>{environmentLoading ? "分析中" : "分析周边"}</Button></div>
                  {environment ? <>
                    <p className="feature-note">{environment.note}</p>
                    <div className="feature-grid">{environment.nearby.map((feature) => <div key={feature.key}><span>{feature.label}</span><b>{feature.count} 个</b><small>{feature.nearestDistanceMeters === null ? "3 km 内无结果" : `最近 ${formatDistance(feature.nearestDistanceMeters)}`}</small></div>)}</div>
                    <p className="feature-roads">道路：{environment.roads.map((road) => road.name).join("、") || "平台暂未返回"}</p>
                    <p className="feature-roads">区域：{environment.address ?? environment.township ?? environment.district ?? "平台暂未返回"}</p>
                  </> : <p className="feature-note">按需读取道路、路口、AOI 及周边医院、车站、垃圾处理设施等特征，不参与自动判定。</p>}
                </section>

                <section className="external-source-card">
                  <div className="section-title"><h3><MessageSquare /> 评论采集工作台</h3><span>人工登录 · 按需读取</span></div>
                  <div className="external-link-row"><input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="粘贴大众点评商户链接" aria-label="大众点评商户链接" /><Button variant="outline" size="sm" onClick={() => saveExternalLink(selected.id)}>保存</Button></div>
                  {externalLinks[selected.id] && <a href={externalLinks[selected.id]} target="_blank" rel="noreferrer">人工登录并打开评论页面 <ExternalLink /></a>}
                  <div className="review-capture-form">
                    <label className="review-screenshot-input"><Camera /><span>{reviewScreenshot?.name ?? "选择评论截图"}</span><input type="file" accept="image/*" onChange={(event) => setReviewScreenshot(event.target.files?.[0] ?? null)} /></label>
                    <label><span><FileText /> 截图识别文字</span><textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder="登录后打开商户评论页；由截图识别得到的原文会填写在这里，保存前请人工核对。" aria-label="评论识别文字" /></label>
                    <Button size="sm" onClick={() => void storeReviewCapture(selected)}><ShieldCheck />确认并保存评论证据</Button>
                  </div>
                  <p>登录、验证码和安全验证由你完成。系统只保存你主动提交的可见截图、来源链接与核对后的文字，不进行后台批量翻页。</p>
                  {selectedReviewCaptures.length > 0 && <div className="review-capture-list"><b>已保存评论证据</b>{selectedReviewCaptures.map((capture) => <article key={capture.id}>
                    <div><span>{formatTimestamp(capture.capturedAt)}</span><small>{capture.screenshotName ?? "无截图"}</small></div>
                    <p>{capture.text}</p>
                    <div><a href={capture.sourceUrl} target="_blank" rel="noreferrer">查看来源</a>{capture.screenshotName && <button onClick={() => void showReviewScreenshot(capture)}>查看截图</button>}</div>
                  </article>)}</div>}
                  {reviewPreviewUrl && <div className="review-screenshot-preview">
                    <button onClick={() => setReviewPreviewUrl(null)} aria-label="关闭截图预览"><X /></button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={reviewPreviewUrl} alt="评论截图证据" />
                  </div>}
                </section>
              </article>
            </>
          )}
        </aside>
      </section>
      <Toaster position="top-center" />
    </main>
  );
}

function translateViewport(viewport: MapViewport, center: MapCenter): MapViewport {
  const longitudeDelta = center.longitude - viewport.center.longitude;
  const latitudeDelta = center.latitude - viewport.center.latitude;
  return {
    center,
    zoom: viewport.zoom,
    bounds: {
      west: viewport.bounds.west + longitudeDelta,
      east: viewport.bounds.east + longitudeDelta,
      south: viewport.bounds.south + latitudeDelta,
      north: viewport.bounds.north + latitudeDelta,
    },
  };
}

function SetupOrError({ error, hasMapKey, onRetry }: { error: RestaurantSearchError; hasMapKey: boolean; onRetry: () => void }) {
  const missingServerKey = error.code === "AMAP_KEY_MISSING";
  return <div className="setup-panel">
    <span className="setup-icon"><AlertCircle /></span>
    <h2>{missingServerKey ? "V5 已就绪，等待真实数据密钥" : "真实数据暂时无法读取"}</h2><p>{error.error}</p>
    <div className="setup-checklist">
      <div className={hasMapKey ? "done" : ""}><span>{hasMapKey ? "✓" : "1"}</span><b>浏览器地图密钥</b><code>NEXT_PUBLIC_AMAP_JS_KEY</code></div>
      <div className={hasMapKey ? "done" : ""}><span>{hasMapKey ? "✓" : "2"}</span><b>JS 安全密钥</b><code>NEXT_PUBLIC_AMAP_SECURITY_JS_CODE</code></div>
      {!PAGES_MODE && <div className={missingServerKey ? "" : "done"}><span>{missingServerKey ? "3" : "✓"}</span><b>服务端 POI 密钥</b><code>AMAP_WEB_SERVICE_KEY</code></div>}
    </div>
    {!missingServerKey && <Button onClick={onRetry}><RefreshCw />重新请求</Button>}
    <p className="setup-note">系统不会用模拟餐馆填补缺失数据。</p>
  </div>;
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function amapMarkerUrl(restaurant: Restaurant) {
  const params = new URLSearchParams({
    position: `${restaurant.longitude},${restaurant.latitude}`,
    name: restaurant.name, coordinate: "gaode", callnative: "0",
  });
  return `https://uri.amap.com/marker?${params}`;
}
