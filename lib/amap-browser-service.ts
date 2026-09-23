import { loadAmap } from "@/components/real-map";
import type { MapBounds, MapViewport, Restaurant, RestaurantSearchResponse, RestaurantStatus } from "@/lib/restaurant-types";

type Point = { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number } | string | [number, number];
type Poi = {
  id?: string; name?: string; type?: string; typecode?: string; location?: Point; address?: string | string[];
  tel?: string | string[]; distance?: number | string; photos?: Array<{ title?: string; url?: string }>;
  rating?: string; cost?: string; biz_ext?: { rating?: string; cost?: string }; business?: {
    rating?: string; cost?: string; business_area?: string; opentime_today?: string;
    opentime_week?: string; tel?: string; tag?: string;
  };
};
type SearchResult = { info?: string; poiList?: { pois?: Poi[] }; pois?: Poi[] };
type PlaceSearch = {
  searchInBounds(keyword: string, bounds: number[][], callback: (status: string, result: SearchResult) => void): void;
  searchNearBy(keyword: string, center: number[], radius: number, callback: (status: string, result: SearchResult) => void): void;
};
type Geocoder = {
  getLocation(keyword: string, callback: (status: string, result: { geocodes?: Array<{ formattedAddress?: string; location?: Point }> }) => void): void;
  getAddress(location: number[], callback: (status: string, result: {
    regeocode?: {
      formattedAddress?: string;
      addressComponent?: { district?: string; township?: string };
      roads?: Array<{ name?: string; distance?: string }>;
      roadinters?: Array<{ first_name?: string; second_name?: string; distance?: string }>;
      aois?: Array<{ name?: string; type?: string; area?: string; distance?: string }>;
    };
  }) => void): void;
};
type SearchAMap = {
  plugin(names: string[], callback: () => void): void;
  PlaceSearch: new (options: Record<string, unknown>) => PlaceSearch;
  Geocoder: new (options: Record<string, unknown>) => Geocoder;
};

async function plugins(key: string, securityCode: string): Promise<SearchAMap> {
  const amap = await loadAmap(key, securityCode);
  await new Promise<void>((resolve) => amap.plugin(["AMap.PlaceSearch", "AMap.Geocoder"], resolve));
  return amap as unknown as SearchAMap;
}

function coords(point: Point | undefined): [number, number] | null {
  if (!point) return null;
  if (Array.isArray(point)) return point.length === 2 && point.every(Number.isFinite) ? [point[0], point[1]] : null;
  if (typeof point === "string") {
    const values = point.split(",").map(Number);
    return values.length === 2 && values.every(Number.isFinite) ? [values[0], values[1]] : null;
  }
  const longitude = point.getLng?.() ?? point.lng;
  const latitude = point.getLat?.() ?? point.lat;
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude!, latitude!] : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || Array.isArray(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" · ") || null;
  return null;
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(b[1] - a[1]);
  const longitudeDelta = radians(b[0] - a[0]);
  const part = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(part), Math.sqrt(1 - part)));
}

function normalizePoi(poi: Poi, center: [number, number], fetchedAt: string): Restaurant | null {
  const location = coords(poi.location);
  if (!poi.id || !poi.name || !location) return null;
  if (!/^餐饮服务(?:;|$)/.test(poi.type ?? "")) return null;
  const type = poi.type ?? "餐饮服务";
  const category = type.split(";").filter(Boolean).at(-1) ?? "餐饮";
  // AMap occasionally includes unrelated businesses under a broad restaurant query.
  if (/生活服务|美容|广告|图文|打印|复印|商场|超市|便利店|酒店|住宿|教育|金融|医疗|健身|洗浴|足浴|棋牌|娱乐/.test(category)) return null;
  const business = poi.business ?? {};
  const rating = numberOrNull(business.rating ?? poi.biz_ext?.rating ?? poi.rating);
  if (rating !== null && (rating < 3 || rating > 4.7)) return null;
  const averageCost = numberOrNull(business.cost ?? poi.biz_ext?.cost ?? poi.cost);
  const telephone = textOrNull(business.tel) ?? textOrNull(poi.tel);
  const openingHours = textOrNull(business.opentime_today) ?? textOrNull(business.opentime_week);
  const photos = (Array.isArray(poi.photos) ? poi.photos : []).filter((photo) => Boolean(photo.url)).slice(0, 3)
    .map((photo) => ({ title: photo.title?.trim() || `${poi.name}图片`, url: photo.url! }));
  const tags = (business.tag ?? "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  const fieldCount = [telephone, openingHours, photos.length, tags.length].filter(Boolean).length;
  const completeness = Math.min(100, 40 + (averageCost === null ? 0 : 12) + fieldCount * 12);
  let status: RestaurantStatus = "explore";
  if (rating !== null && rating >= 4.6) status = "high";
  else if (rating !== null && rating >= 4) status = "potential";
  return {
    id: poi.id, provider: "amap", name: poi.name, category,
    type, longitude: location[0], latitude: location[1], distanceMeters: distanceMeters(center, location),
    address: textOrNull(poi.address), telephone, businessArea: textOrNull(business.business_area), openingHours,
    rating, averageCost, tags, photos, dataCompleteness: completeness, status,
    reasons: [rating === null ? "高德暂未返回评分" : `高德真实评分 ${rating.toFixed(1)}`,
      averageCost === null ? "高德暂未返回人均消费" : `人均约 ¥${Math.round(averageCost)}`,
      "连锁与娱乐场所由 V4 本地规则处理"], fetchedAt,
  };
}

function grid(bounds: MapBounds, zoom: number) {
  const [columns, rows] = zoom >= 16 ? [1, 1] : zoom >= 15 ? [2, 1] : [2, 2];
  const cells: MapBounds[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    cells.push({
      west: bounds.west + (bounds.east - bounds.west) * column / columns,
      east: bounds.west + (bounds.east - bounds.west) * (column + 1) / columns,
      south: bounds.south + (bounds.north - bounds.south) * row / rows,
      north: bounds.south + (bounds.north - bounds.south) * (row + 1) / rows,
    });
  }
  return { columns, rows, cells };
}

function searchBounds(search: PlaceSearch, keyword: string, bounds: MapBounds): Promise<Poi[]> {
  const polygon = [[bounds.west, bounds.south], [bounds.east, bounds.south],
    [bounds.east, bounds.north], [bounds.west, bounds.north]];
  return new Promise((resolve, reject) => search.searchInBounds(keyword, polygon, (status, result) => {
    if (status === "complete") resolve(result.poiList?.pois ?? result.pois ?? []);
    else if (status === "no_data") resolve([]);
    else reject(new Error(result.info || "高德范围搜索失败"));
  }));
}

function searchNearby(search: PlaceSearch, keyword: string, center: [number, number], radius: number): Promise<Poi[]> {
  return new Promise((resolve, reject) => search.searchNearBy(keyword, center, radius, (status, result) => {
    if (status === "complete") resolve(result.poiList?.pois ?? result.pois ?? []);
    else if (status === "no_data") resolve([]);
    else reject(new Error(result.info || "高德周边搜索失败"));
  }));
}

export async function searchRestaurants(input: {
  key: string; securityCode: string; center: { longitude: number; latitude: number };
  viewport: MapViewport | null; keywords: string; signal?: AbortSignal;
}): Promise<RestaurantSearchResponse> {
  if (!input.key || !input.securityCode) throw new Error("请配置高德 JS API Key 与安全密钥。");
  const amap = await plugins(input.key, input.securityCode);
  const center: [number, number] = [input.center.longitude, input.center.latitude];
  const search = new amap.PlaceSearch({ type: "050000", pageSize: 25, pageIndex: 1, extensions: "all" });
  const plan = input.viewport ? grid(input.viewport.bounds, input.viewport.zoom) : null;
  const cells = plan?.cells ?? [{
    west: center[0] - 0.03, east: center[0] + 0.03,
    south: center[1] - 0.03, north: center[1] + 0.03,
  }];
  const pois: Poi[] = [];
  let completed = 0;
  for (const cell of cells) {
    if (input.signal?.aborted) throw new DOMException("已取消", "AbortError");
    try {
      pois.push(...await searchBounds(search, input.keywords.trim(), cell));
      completed++;
    } catch (error) {
      if (completed === 0 && cell === cells.at(-1)) throw error;
    }
    if (cells.length > 1) await new Promise((resolve) => window.setTimeout(resolve, 380));
  }
  if (input.signal?.aborted) throw new DOMException("已取消", "AbortError");
  const seen = new Set<string>();
  const fetchedAt = new Date().toISOString();
  const restaurants = pois.filter((poi) => Boolean(poi.id) && !seen.has(poi.id!) && Boolean(seen.add(poi.id!)))
    .map((poi) => normalizePoi(poi, center, fetchedAt))
    .filter((restaurant): restaurant is Restaurant => restaurant !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    source: "amap", sourceLabel: "高德地图 JS API", fetchedAt, center: input.center,
    radiusMeters: 3000, restaurants,
    searchPlan: input.viewport && plan ? {
      zoom: input.viewport.zoom, gridColumns: plan.columns, gridRows: plan.rows,
      queryCount: cells.length, completedQueries: completed, partial: completed < cells.length,
      bounds: input.viewport.bounds,
    } : undefined,
  };
}

export async function searchCity(key: string, securityCode: string, keyword: string) {
  const amap = await plugins(key, securityCode);
  const geocoder = new amap.Geocoder({ city: "全国" });
  const result = await new Promise<{ geocodes?: Array<{ formattedAddress?: string; location?: Point }> }>((resolve, reject) => {
    geocoder.getLocation(keyword, (status, value) => status === "complete" ? resolve(value) : reject(new Error("城市查询失败")));
  });
  const first = result.geocodes?.find((item) => coords(item.location));
  const center = coords(first?.location);
  if (!center) throw new Error(`没有找到“${keyword}”，请尝试输入完整城市名。`);
  return { name: first?.formattedAddress || keyword, center: { longitude: center[0], latitude: center[1] } };
}

export async function searchFeatures(key: string, securityCode: string, longitude: number, latitude: number) {
  const amap = await plugins(key, securityCode);
  const geocoder = new amap.Geocoder({ radius: 3000, extensions: "all" });
  const center: [number, number] = [longitude, latitude];
  const result = await new Promise<Parameters<Geocoder["getAddress"]>[1] extends (status: string, result: infer R) => void ? R : never>((resolve, reject) => {
    geocoder.getAddress(center, (status, value) => status === "complete" ? resolve(value) : reject(new Error("环境特征查询失败")));
  });
  const groups = [
    { key: "hospitals", label: "医院", type: "090000", keyword: "" },
    { key: "stations", label: "火车站", type: "150100", keyword: "" },
    { key: "wasteFacilities", label: "垃圾处理设施", type: "050000", keyword: "垃圾处理" },
  ];
  const nearby = await Promise.all(groups.map(async (group) => {
    try {
      const search = new amap.PlaceSearch({ type: group.type, pageSize: 10, extensions: "base" });
      const pois = await searchNearby(search, group.keyword, center, 3000);
      const distances = pois.map((poi) => numberOrNull(poi.distance) ?? (coords(poi.location) ? distanceMeters(center, coords(poi.location)!) : null))
        .filter((value): value is number => value !== null);
      return { key: group.key, label: group.label, count: pois.length, nearestDistanceMeters: distances.length ? Math.min(...distances) : null };
    } catch { return { key: group.key, label: group.label, count: 0, nearestDistanceMeters: null }; }
  }));
  const regeo = result.regeocode;
  return {
    source: "amap", fetchedAt: new Date().toISOString(), center: { longitude, latitude },
    address: regeo?.formattedAddress ?? null, district: regeo?.addressComponent?.district ?? null,
    township: regeo?.addressComponent?.township ?? null,
    roads: (regeo?.roads ?? []).slice(0, 5).map((road) => ({ name: road.name || "未命名道路", distanceMeters: numberOrNull(road.distance) })),
    roadIntersections: (regeo?.roadinters ?? []).slice(0, 5).map((road) => ({
      name: [road.first_name, road.second_name].filter(Boolean).join(" / ") || "未命名路口",
      distanceMeters: numberOrNull(road.distance),
    })),
    aois: (regeo?.aois ?? []).slice(0, 5).map((aoi) => ({
      name: aoi.name || "未命名区域", type: aoi.type ?? null, area: numberOrNull(aoi.area), distanceMeters: numberOrNull(aoi.distance),
    })), nearby, note: "环境关系仅作为特征展示，不直接代表商户好坏。",
  };
}
