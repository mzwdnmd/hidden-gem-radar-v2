import { NextRequest, NextResponse } from "next/server";

import type {
  MapBounds,
  Restaurant,
  RestaurantPhoto,
  RestaurantSearchError,
  RestaurantSearchResponse,
  RestaurantStatus,
} from "@/lib/restaurant-types";

type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  location?: string;
  distance?: string;
  address?: string | string[];
  tel?: string | string[];
  business?: {
    business_area?: string;
    opentime_today?: string;
    opentime_week?: string;
    tel?: string;
    tag?: string;
    rating?: string;
    cost?: string;
  };
  photos?: Array<{ title?: string; url?: string }>;
};

type AmapResponse = {
  status?: string;
  info?: string;
  infocode?: string;
  pois?: AmapPoi[];
};

const DEFAULT_LONGITUDE = 104.147;
const DEFAULT_LATITUDE = 30.676;
const RESTAURANT_TYPE = "050000";
const MINIMUM_RATING = 3;
const MAXIMUM_RATING = 4.7;
// Each grid cell requests one page. Searches remain user-triggered so panning and
// zooming alone never consume the Web Service quota.
const SEARCH_PAGE_COUNT = 1;
const RESTAURANT_CACHE_TTL_MS = 2 * 60 * 1000;
const restaurantCache = new Map<string, { expiresAt: number; payload: RestaurantSearchResponse }>();

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json<RestaurantSearchError>(
      {
        error: "服务端尚未配置高德 Web Service API Key。",
        code: "AMAP_KEY_MISSING",
      },
      { status: 503 },
    );
  }

  const params = request.nextUrl.searchParams;
  const longitude = parseCoordinate(params.get("lng"), DEFAULT_LONGITUDE, -180, 180);
  const latitude = parseCoordinate(params.get("lat"), DEFAULT_LATITUDE, -90, 90);
  const radiusMeters = clamp(parseInteger(params.get("radius"), 3000), 500, 5000);
  const keywords = (params.get("keywords") ?? "").trim().slice(0, 80);
  const zoom = clamp(Number(params.get("zoom") ?? 15), 11, 17);
  const bounds = parseBounds(params);

  if (longitude === null || latitude === null) {
    return NextResponse.json<RestaurantSearchError>(
      { error: "地图中心坐标无效。", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const searchGrid = buildSearchGrid({ longitude, latitude }, bounds, zoom, radiusMeters);
  const cacheKey = [
    longitude.toFixed(4), latitude.toFixed(4), zoom.toFixed(1), keywords,
    bounds ? [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(4)).join(",") : radiusMeters,
  ].join("|");
  const cached = restaurantCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.payload);
  if (cached) restaurantCache.delete(cacheKey);

  try {
    const requestUrls = searchGrid.points.flatMap((point) => Array.from({ length: SEARCH_PAGE_COUNT }, (_, index) => {
      const pageParams = new URLSearchParams({
        key: apiKey,
        types: RESTAURANT_TYPE,
        page_size: "25",
        page_num: String(index + 1),
        show_fields: "business,photos",
      });
      const endpoint = point.bounds ? "polygon" : "around";
      if (point.bounds) {
        pageParams.set("polygon", `${point.bounds.west.toFixed(6)},${point.bounds.north.toFixed(6)}|${point.bounds.east.toFixed(6)},${point.bounds.south.toFixed(6)}`);
      } else {
        pageParams.set("location", `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`);
        pageParams.set("radius", String(point.radiusMeters));
      }
      if (keywords) pageParams.set("keywords", keywords);
      return `https://restapi.amap.com/v5/place/${endpoint}?${pageParams}`;
    }));
    const responses: Response[] = [];
    for (const [index, url] of requestUrls.entries()) {
      if (index > 0) await delay(380);
      responses.push(await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" }));
    }
    const decoded: AmapResponse[] = await Promise.all(responses.map(async (response): Promise<AmapResponse> => response.ok
      ? response.json() as Promise<AmapResponse>
      : ({ status: "0", info: `HTTP ${response.status}` })));
    const payloads = decoded.filter((payload) => payload.status === "1");
    if (!payloads.length) {
      const failure = decoded.find((payload) => payload.status !== "1");
      return upstreamFailure(failure?.info || `高德服务错误 ${failure?.infocode ?? "unknown"}。`);
    }

    const fetchedAt = new Date().toISOString();
    const seenPoiIds = new Set<string>();
    const restaurants = payloads.flatMap((payload) => payload.pois ?? [])
      .filter((poi) => Boolean(poi.id) && !seenPoiIds.has(poi.id!) && Boolean(seenPoiIds.add(poi.id!)))
      .map((poi) => normalizePoi(poi, fetchedAt))
      .filter((restaurant): restaurant is Restaurant => restaurant !== null)
      .map((restaurant) => ({
        ...restaurant,
        distanceMeters: Math.round(distanceMeters(latitude, longitude, restaurant.latitude, restaurant.longitude)),
      }))
      .filter((restaurant) => !bounds || (
        restaurant.longitude >= bounds.west && restaurant.longitude <= bounds.east
        && restaurant.latitude >= bounds.south && restaurant.latitude <= bounds.north
      ))
      .sort((a, b) => a.name.localeCompare(b.name));

    const result: RestaurantSearchResponse = {
      source: "amap",
      sourceLabel: "高德开放平台",
      fetchedAt,
      center: { longitude, latitude },
      radiusMeters: searchGrid.radiusMeters,
      restaurants,
      searchPlan: bounds ? {
        zoom,
        gridColumns: searchGrid.columns,
        gridRows: searchGrid.rows,
        queryCount: searchGrid.points.length,
        completedQueries: payloads.length,
        partial: payloads.length < searchGrid.points.length,
        bounds,
      } : undefined,
    };
    restaurantCache.set(cacheKey, { expiresAt: Date.now() + RESTAURANT_CACHE_TTL_MS, payload: result });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    return upstreamFailure(`无法连接高德服务：${message}`);
  }
}

function parseBounds(params: URLSearchParams): MapBounds | null {
  const west = Number(params.get("west"));
  const south = Number(params.get("south"));
  const east = Number(params.get("east"));
  const north = Number(params.get("north"));
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  if (east - west > 3 || north - south > 3) return null;
  return { west, south, east, north };
}

type SearchGridPoint = {
  longitude: number;
  latitude: number;
  radiusMeters: number;
  bounds?: MapBounds;
};

function buildSearchGrid(center: { longitude: number; latitude: number }, bounds: MapBounds | null, zoom: number, fallbackRadius: number): {
  columns: number;
  rows: number;
  radiusMeters: number;
  points: SearchGridPoint[];
} {
  if (!bounds) return { columns: 1, rows: 1, radiusMeters: fallbackRadius, points: [{ ...center, radiusMeters: fallbackRadius }] };
  const [columns, rows] = zoom >= 16 ? [1, 1] : zoom >= 15 ? [2, 1] : [2, 2];
  const cellLongitude = (bounds.east - bounds.west) / columns;
  const cellLatitude = (bounds.north - bounds.south) / rows;
  const cellCenterLatitude = (bounds.north + bounds.south) / 2;
  const cellDiagonal = distanceMeters(
    cellCenterLatitude - cellLatitude / 2,
    center.longitude - cellLongitude / 2,
    cellCenterLatitude + cellLatitude / 2,
    center.longitude + cellLongitude / 2,
  );
  const cellRadius = Math.round(clamp(cellDiagonal * 0.58, 700, 5000));
  const points = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ({
    longitude: bounds.west + cellLongitude * (column + 0.5),
    latitude: bounds.south + cellLatitude * (row + 0.5),
    radiusMeters: cellRadius,
    bounds: {
      west: bounds.west + cellLongitude * column,
      east: bounds.west + cellLongitude * (column + 1),
      south: bounds.south + cellLatitude * row,
      north: bounds.south + cellLatitude * (row + 1),
    },
  }))).flat();
  return { columns, rows, radiusMeters: cellRadius, points };
}

function distanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizePoi(poi: AmapPoi, fetchedAt: string): Restaurant | null {
  if (!poi.id || !poi.name || !poi.location) return null;
  const [longitude, latitude] = poi.location.split(",").map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const business = poi.business ?? {};
  const rating = nullableNumber(business.rating);
  if (rating !== null && (rating < MINIMUM_RATING || rating > MAXIMUM_RATING)) return null;
  const averageCost = nullableNumber(business.cost);
  const distanceMeters = Math.max(0, nullableNumber(poi.distance) ?? 0);
  const type = poi.type ?? "餐饮服务";
  const category = type.split(";").filter(Boolean).at(-1) ?? "餐饮";
  const telephone = textValue(business.tel) ?? textValue(poi.tel);
  const openingHours = textValue(business.opentime_today) ?? textValue(business.opentime_week);
  const photos: RestaurantPhoto[] = (poi.photos ?? [])
    .filter((photo) => Boolean(photo.url))
    .slice(0, 3)
    .map((photo) => ({ title: photo.title?.trim() || `${poi.name}图片`, url: photo.url! }));
  const tags = (business.tag ?? "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  const { dataCompleteness, status, reasons } = calculateSelectionSignals({
    rating,
    averageCost,
    hasTelephone: Boolean(telephone),
    hasOpeningHours: Boolean(openingHours),
    hasPhoto: photos.length > 0,
    hasTags: tags.length > 0,
  });

  return {
    id: poi.id,
    provider: "amap",
    name: poi.name,
    category,
    type,
    longitude,
    latitude,
    distanceMeters,
    address: textValue(poi.address),
    telephone,
    businessArea: textValue(business.business_area),
    openingHours,
    rating,
    averageCost,
    tags,
    photos,
    dataCompleteness,
    status,
    reasons,
    fetchedAt,
  };
}

function calculateSelectionSignals(input: {
  rating: number | null;
  averageCost: number | null;
  hasTelephone: boolean;
  hasOpeningHours: boolean;
  hasPhoto: boolean;
  hasTags: boolean;
}) {
  let completeness = 40;
  const reasons = [input.rating === null ? "高德暂未返回评分" : `高德真实评分 ${input.rating.toFixed(1)}`, "连锁与娱乐场所由 V4 本地规则处理"];

  if (input.averageCost !== null) {
    completeness += 12;
    reasons.push(`人均约 ¥${Math.round(input.averageCost)}`);
  }

  const populatedFields = [input.hasTelephone, input.hasOpeningHours, input.hasPhoto, input.hasTags]
    .filter(Boolean).length;
  completeness += populatedFields * 12;
  let status: RestaurantStatus = "explore";
  if (input.rating !== null && input.rating >= 4.6) status = "high";
  else if (input.rating !== null && input.rating >= 4) status = "potential";

  return {
    dataCompleteness: clamp(completeness, 0, 100),
    status,
    reasons: reasons.slice(0, 4),
  };
}

function upstreamFailure(error: string) {
  return NextResponse.json<RestaurantSearchError>(
    { error, code: "UPSTREAM_ERROR" },
    { status: 502 },
  );
}

function parseCoordinate(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "" || Array.isArray(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const joined = value.filter((item): item is string => typeof item === "string").join(" · ").trim();
    return joined || null;
  }
  return null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
