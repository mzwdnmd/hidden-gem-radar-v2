import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.pages.config.ts", server: { middlewareMode: true } });

try {
  const { DIANPING_HOME_URL, dianpingSearchText, dianpingShopUrl, formatDianpingExport, verifiedDianpingUrl } =
    await server.ssrLoadModule("/lib/dianping-handoff.ts");
  const matched = { id: "B0HR2HVARZ", name: "老厨子明档菜（龙潭寺店）", businessArea: "龙潭寺", address: "龙港路30号", recommendation: { score: 58 } };
  const unknown = { id: "unknown", name: "张家面馆", businessArea: "建设路", address: "建设路1号", recommendation: { score: 52 } };
  assert.equal(dianpingShopUrl("629012700"), "https://www.dianping.com/shop/629012700");
  assert.equal(dianpingShopUrl("bad/id"), null);
  assert.equal(verifiedDianpingUrl(matched.id), dianpingShopUrl("629012700"));
  assert.equal(verifiedDianpingUrl(unknown.id), null);
  assert.equal(verifiedDianpingUrl(unknown.id, "https://h5.dianping.com/shop/test"), "https://h5.dianping.com/shop/test");
  assert.equal(verifiedDianpingUrl(unknown.id, "https://evil.example/shop/1"), null);
  assert.equal(verifiedDianpingUrl(unknown.id, "javascript:alert(1)"), null);
  assert.equal(dianpingSearchText(matched, "成都"), "成都 老厨子明档菜（龙潭寺店）");
  assert.equal(dianpingSearchText(unknown, "成都"), "成都 张家面馆 建设路");
  const exportText = formatDianpingExport([matched, unknown], "成都");
  assert.match(exportText, /当前搜索结果（2 家）/);
  assert.match(exportText, /大众点评：https:\/\/www\.dianping\.com\/shop\/629012700/);
  assert.match(exportText, new RegExp(`大众点评：请在 ${DIANPING_HOME_URL.replaceAll(".", "\\.")} 搜索上方文字`));
  assert.ok(exportText.indexOf("老厨子明档菜") < exportText.indexOf("张家面馆"));
  console.log("大众点评交接测试通过：搜索词、核准直达、无匹配回退和当前结果导出");
} finally {
  await server.close();
}
