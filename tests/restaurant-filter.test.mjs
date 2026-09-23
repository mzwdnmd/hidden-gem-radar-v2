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
  const { getFilterReason } = await server.ssrLoadModule("/lib/restaurant-filter.ts");
  const options = { blacklistedIds: new Set(), brandBlacklist: [], entertainmentWhitelist: new Set() };
  assert.equal(getFilterReason(restaurant("a", "厨房用品店"), options), "non_dining_name");
  assert.equal(getFilterReason(restaurant("b", "某某餐饮管理公司"), options), "non_dining_name");
  assert.equal(getFilterReason(restaurant("c", "川香茶府"), options), "entertainment_name");
  assert.equal(getFilterReason(restaurant("d", "某某棋牌室"), options), "entertainment_name");
  assert.equal(getFilterReason(restaurant("e", "办公用品商行", { category: "购物服务" }), options), "non_dining_name");
  assert.equal(getFilterReason(restaurant("f", "家常菜馆"), options), null);
  assert.equal(getFilterReason(restaurant("g", "家常菜馆", { type: "餐饮服务;购物服务" }), options), "non_dining_type");
  assert.equal(getFilterReason(restaurant("a", "厨房用品店"), { ...options, entertainmentWhitelist: new Set(["a"]) }), null);
  assert.equal(getFilterReason(restaurant("a", "厨房用品店"), { ...options, blacklistedIds: new Set(["a"]), entertainmentWhitelist: new Set(["a"]) }), "restaurant_blacklist");
  console.log("默认屏蔽测试通过：用品、公司、茶府、棋牌、类型与误判恢复");
} finally {
  await server.close();
}
