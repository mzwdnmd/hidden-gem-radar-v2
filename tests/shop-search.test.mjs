import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.pages.config.ts", server: { middlewareMode: true } });
const calls = [];

try {
  const { searchShops } = await server.ssrLoadModule("/lib/amap-browser-service.ts");
  globalThis.window = {
    AMap: {
      plugin(names, callback) { callback(); },
      PlaceSearch: class {
        constructor(options) { calls.push(options); }
        search(keyword, callback) {
          calls.push(keyword);
          callback("complete", { poiList: { pois: [
            { id: "branch", name: "李与白包子铺(春熙路店)", type: "餐饮服务;中餐厅", location: "104.08,30.67", business: { rating: "4.9", cost: "35" } },
            { id: "exact", name: "李与白包子铺", type: "餐饮服务;中餐厅", location: "104.06,30.65", business: { rating: "4.8", cost: "28" } },
            { id: "office", name: "李与白公司", type: "公司企业", location: "104.01,30.61" },
          ] } });
        }
      },
    },
  };
  const results = await searchShops({ key: "test", securityCode: "test", keyword: "李与白包子铺", city: "成都", center: null });
  assert.equal(calls[0].city, "成都");
  assert.equal(calls[0].citylimit, true);
  assert.equal(calls[0].pageSize, 50);
  assert.equal(calls[1], "李与白包子铺");
  assert.deepEqual(results.map((item) => item.id), ["exact", "branch"]);
  assert.equal(results[0].rating, 4.8); // Direct lookup can find shops outside the candidate rating band.
  await assert.rejects(() => searchShops({ key: "test", securityCode: "test", keyword: " ", city: "", center: null }), /请输入店铺名称/);
  console.log("店铺查找测试通过：按城市搜索、店名排序、地图外与超候选评分店铺");
} finally {
  delete globalThis.window;
  await server.close();
}
