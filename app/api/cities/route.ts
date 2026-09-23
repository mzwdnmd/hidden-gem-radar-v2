import { NextRequest, NextResponse } from "next/server";

type AmapDistrict = {
  name?: string;
  center?: string;
  adcode?: string;
  level?: string;
};

type AmapDistrictResponse = {
  status?: string;
  info?: string;
  districts?: AmapDistrict[];
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "服务端尚未配置高德 Web Service API Key。" }, { status: 503 });
  }

  const keyword = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!keyword) return NextResponse.json({ error: "请输入城市名称。" }, { status: 400 });

  const params = new URLSearchParams({
    key: apiKey,
    keywords: keyword,
    subdistrict: "0",
    extensions: "base",
  });

  try {
    const response = await fetch(`https://restapi.amap.com/v3/config/district?${params}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: `高德行政区服务返回 HTTP ${response.status}。` }, { status: 502 });
    }
    const payload = (await response.json()) as AmapDistrictResponse;
    if (payload.status !== "1") {
      return NextResponse.json({ error: payload.info || "城市查询失败。" }, { status: 502 });
    }

    const district = payload.districts?.find((item) => item.center && item.name);
    if (!district?.center || !district.name) {
      return NextResponse.json({ error: `没有找到“${keyword}”，请尝试输入完整城市名。` }, { status: 404 });
    }
    const [longitude, latitude] = district.center.split(",").map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return NextResponse.json({ error: "城市中心坐标无效。" }, { status: 502 });
    }

    return NextResponse.json({
      name: district.name,
      adcode: district.adcode ?? null,
      level: district.level ?? null,
      center: { longitude, latitude },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    return NextResponse.json({ error: `无法连接高德行政区服务：${message}` }, { status: 502 });
  }
}
