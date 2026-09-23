import type { BrandBlacklistEntry, FilterReason, Restaurant } from "@/lib/restaurant-types";
import { isSameBrand } from "@/lib/brand-normalizer";

const ENTERTAINMENT_NAME_PATTERNS = [
  /茶府/u, /茶楼/u, /茶馆/u, /茶室/u, /茶社/u, /棋牌/u, /麻将/u, /桌游/u, /网吧/u, /网咖/u, /台球/u,
  /KTV/iu, /歌舞厅/u, /足浴/u, /洗浴/u, /娱乐会所/u,
];
const ENTERTAINMENT_TYPE_PATTERN = /棋牌|麻将|网吧|网咖|KTV|歌舞厅|台球|足浴|洗浴|娱乐场所/iu;

export function getEntertainmentReason(restaurant: Restaurant): FilterReason | null {
  if (ENTERTAINMENT_NAME_PATTERNS.some((pattern) => pattern.test(restaurant.name))) return "entertainment_name";
  if (ENTERTAINMENT_TYPE_PATTERN.test(`${restaurant.type} ${restaurant.category} ${restaurant.tags.join(" ")}`)) {
    return "entertainment_type";
  }
  return null;
}

export function getFilterReason(
  restaurant: Restaurant,
  options: { blacklistedIds: Set<string>; brandBlacklist: BrandBlacklistEntry[]; entertainmentWhitelist: Set<string> },
) {
  if (options.blacklistedIds.has(restaurant.id)) return "restaurant_blacklist" as const;
  if (options.brandBlacklist.some((entry) => isSameBrand(restaurant.name, entry))) return "chain_brand_blacklist" as const;
  if (!options.entertainmentWhitelist.has(restaurant.id)) return getEntertainmentReason(restaurant);
  return null;
}

export const filterReasonLabels: Record<FilterReason, string> = {
  entertainment_name: "名称命中娱乐场所规则",
  entertainment_type: "分类命中娱乐场所规则",
  restaurant_blacklist: "用户单店黑名单",
  chain_brand_blacklist: "命中已屏蔽连锁品牌",
};
