import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.pages.config.ts", server: { middlewareMode: true } });

function restaurant(id, name, overrides = {}) {
  return {
    id, provider: "amap", name, category: "中餐厅", type: "餐饮服务;中餐厅",
    longitude: 104, latitude: 30, distanceMeters: 0, address: null, telephone: null,
    businessArea: null, openingHours: null, rating: 4, averageCost: 50,
    tags: [], photos: [], dataCompleteness: 60, status: "potential", reasons: [], fetchedAt: "2026-09-23",
    ...overrides,
  };
}

try {
  const { getFilterReason, matchesAverageCost } = await server.ssrLoadModule("/lib/restaurant-filter.ts");
  const { isPublicChainName, PUBLIC_CHAIN_BRANDS } = await server.ssrLoadModule("/lib/public-brand-blacklist.ts");
  const options = { blacklistedIds: new Set(), brandBlacklist: [], entertainmentWhitelist: new Set() };
  assert.equal(getFilterReason(restaurant("a", "厨房用品店"), options), "non_dining_name");
  assert.equal(getFilterReason(restaurant("b", "某某餐饮管理公司"), options), "non_dining_name");
  assert.equal(getFilterReason(restaurant("c", "川香茶府"), options), "entertainment_name");
  assert.equal(getFilterReason(restaurant("d", "某某棋牌室"), options), "entertainment_name");
  assert.equal(getFilterReason(restaurant("e", "办公用品商行", { category: "购物服务" }), options), "non_dining_name");
  assert.equal(getFilterReason(restaurant("f", "家常菜馆"), options), null);
  assert.equal(getFilterReason(restaurant("g", "家常菜馆", { type: "餐饮服务;购物服务" }), options), "non_dining_type");
  assert.equal(getFilterReason(restaurant("h", "好利来蛋糕店"), options), "non_dining_name");
  assert.equal(PUBLIC_CHAIN_BRANDS.length, 16);
  assert.equal(isPublicChainName("瑞幸咖啡(春熙路店)"), true);
  assert.equal(isPublicChainName("肯悦咖啡(招商花园城)"), true);
  assert.equal(isPublicChainName("塔斯汀(龙泉驿)"), true);
  assert.equal(isPublicChainName("幸福咖啡"), false);
  assert.equal(getFilterReason(restaurant("i", "瑞幸咖啡(春熙路店)"), options), "public_chain_blacklist");
  assert.equal(getFilterReason(restaurant("a", "厨房用品店"), { ...options, entertainmentWhitelist: new Set(["a"]) }), null);
  assert.equal(getFilterReason(restaurant("a", "厨房用品店"), { ...options, blacklistedIds: new Set(["a"]), entertainmentWhitelist: new Set(["a"]) }), "restaurant_blacklist");
  assert.equal(matchesAverageCost(50, { minimum: 40, maximum: 60, includeUnknown: false }), true);
  assert.equal(matchesAverageCost(30, { minimum: 40, maximum: 60, includeUnknown: false }), false);
  assert.equal(matchesAverageCost(null, { minimum: 40, maximum: 60, includeUnknown: false }), false);
  assert.equal(matchesAverageCost(null, { minimum: 40, maximum: 60, includeUnknown: true }), true);
  assert.equal(matchesAverageCost(null, { minimum: null, maximum: null, includeUnknown: false }), true);
  assert.equal(matchesAverageCost(50, { minimum: 60, maximum: 40, includeUnknown: true }), false);
  console.log("默认屏蔽与人均区间测试通过：蛋糕、公共连锁、边界和未知价格");
} finally {
  await server.close();
}
