import { NextRequest, NextResponse } from "next/server";

type RegeoResponse = {
  status?: string;
  info?: string;
  regeocode?: {
    formatted_address?: string;
    addressComponent?: { district?: string; township?: string };
    roads?: Array<{ name?: string; distance?: string }>;
    roadinters?: Array<{ first_name?: string; second_name?: string; distance?: string }>;
    aois?: Array<{ name?: string; type?: string; area?: string; distance?: string }>;
  };
};
type AroundResponse = {
  status?: string;
  info?: string;
  pois?: Array<{ name?: string; location?: string; distance?: string; type?: string }>;
};

const FEATURE_GROUPS: Array<{ key: string; label: string; types?: string; keywords?: string }> = [
  { key: "hospitals", label: "医院", types: "090000" },
  { key: "stations", label: "火车站", types: "150100" },
  { key: "wasteFacilities", label: "垃圾处理设施", keywords: "垃圾处理" },
] as const;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  const longitude = parseCoordinate(request.nextUrl.searchParams.get("lng"), -180, 180);
  const latitude = parseCoordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  if (!apiKey) return NextResponse.json({ error: "服务端尚未配置高德 Web Service API Key。" }, { status: 503 });
  if (longitude === null || latitude === null) return NextResponse.json({ error: "环境特征坐标无效。" }, { status: 400 });

  const base = new URLSearchParams({
    key: apiKey,
    location: `${longitude.toFixed(6)},${latitude.toFixed(6)}`,
    radius: "3000",
    extensions: "all",
  });

  try {
    const regeoResponse = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${base}`, { cache: "no-store" });
    if (!regeoResponse.ok) return failure(`高德逆地理编码返回 HTTP ${regeoResponse.status}。`);
    const regeo = await regeoResponse.json() as RegeoResponse;
    if (regeo.status !== "1") return failure(regeo.info || "逆地理编码失败。");

    const featureResults = await Promise.all(FEATURE_GROUPS.map(async (group) => {
      const params = new URLSearchParams(base);
      params.set("types", group.types ?? "050000");
      params.set("page_size", "10");
      params.set("page_num", "1");
      if (group.keywords) params.set("keywords", group.keywords);
      const response = await fetch(`https://restapi.amap.com/v5/place/around?${params}`, { cache: "no-store" });
      if (!response.ok) return { key: group.key, label: group.label, count: 0, nearestDistanceMeters: null };
      const payload = await response.json() as AroundResponse;
      const pois = payload.status === "1" ? payload.pois ?? [] : [];
      const distances = pois.map((poi) => Number(poi.distance)).filter(Number.isFinite);
      return {
        key: group.key,
        label: group.label,
        count: pois.length,
        nearestDistanceMeters: distances.length ? Math.min(...distances) : null,
      };
    }));

    const component = regeo.regeocode?.addressComponent ?? {};
    const roads = (regeo.regeocode?.roads ?? []).slice(0, 5).map((road) => ({
      name: road.name ?? "未命名道路",
      distanceMeters: nullableNumber(road.distance),
    }));
    const roadIntersections = (regeo.regeocode?.roadinters ?? []).slice(0, 5).map((road) => ({
      name: [road.first_name, road.second_name].filter(Boolean).join(" / ") || "未命名路口",
      distanceMeters: nullableNumber(road.distance),
    }));
    const aois = (regeo.regeocode?.aois ?? []).slice(0, 5).map((aoi) => ({
      name: aoi.name ?? "未命名区域",
      type: aoi.type ?? null,
      area: nullableNumber(aoi.area),
      distanceMeters: nullableNumber(aoi.distance),
    }));

    return NextResponse.json({
      source: "amap",
      fetchedAt: new Date().toISOString(),
      center: { longitude, latitude },
      address: regeo.regeocode?.formatted_address ?? null,
      district: component.district ?? null,
      township: component.township ?? null,
      roads,
      roadIntersections,
      aois,
      nearby: featureResults,
      note: "环境关系仅作为特征展示，不直接代表商户好坏。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    return failure(`无法读取环境特征：${message}`);
  }
}

function parseCoordinate(value: string | null, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function failure(error: string) {
  return NextResponse.json({ error }, { status: 502 });
}
