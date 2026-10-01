import type { Restaurant } from "@/lib/restaurant-types";
import { TRAINING_ALBUM } from "@/lib/training-album";

export const DIANPING_HOME_URL = "https://www.dianping.com/";

export function dianpingShopUrl(dianpingId: string): string | null {
  return /^\d+$/.test(dianpingId) ? `https://www.dianping.com/shop/${dianpingId}` : null;
}

export function verifiedDianpingUrl(amapId: string, savedUrl?: string): string | null {
  if (savedUrl) {
    try {
      const parsed = new URL(savedUrl);
      if (parsed.protocol === "https:" && (parsed.hostname === "dianping.com" || parsed.hostname.endsWith(".dianping.com"))) {
        return parsed.href;
      }
    } catch { /* Ignore malformed personal links. */ }
  }
  const albumEntry = TRAINING_ALBUM.find((entry) => entry.amapId === amapId);
  return albumEntry ? dianpingShopUrl(albumEntry.dianpingId) : null;
}

export function dianpingSearchText(restaurant: Pick<Restaurant, "name" | "businessArea">, city = ""): string {
  const name = restaurant.name.trim().replace(/\s+/gu, " ");
  const area = restaurant.businessArea?.trim() ?? "";
  return [city.trim(), name, area && !name.includes(area) ? area : ""].filter(Boolean).join(" ");
}

export function formatDianpingExport(
  restaurants: Restaurant[], city: string, savedLinks: Record<string, string> = {},
): string {
  const header = [
    `小馆雷达｜当前搜索结果（${restaurants.length} 家）`,
    "候选分来自小馆雷达，不代表大众点评评分。打开点评后请核对城市、地址和分店。",
    "",
  ];
  const entries = restaurants.map((restaurant, index) => {
    const directUrl = verifiedDianpingUrl(restaurant.id, savedLinks[restaurant.id]);
    return [
      `${index + 1}. ${restaurant.name}｜候选分 ${restaurant.recommendation?.score ?? "暂无"}`,
      `点评搜索词：${dianpingSearchText(restaurant, city)}`,
      `高德地址：${restaurant.address ?? "暂无"}`,
      `大众点评：${directUrl ?? `请在 ${DIANPING_HOME_URL} 搜索上方文字`}`,
    ].join("\n");
  });
  return [...header, ...entries].join("\n\n") + "\n";
}
