import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.pages.config.ts", server: { middlewareMode: true } });

function restaurant(id, overrides = {}) {
  return {
    id, provider: "amap", name: id, category: "川菜", type: "餐饮服务;中餐厅",
    longitude: 104, latitude: 30, distanceMeters: 0, address: null, telephone: null,
    businessArea: "城南", openingHours: null, rating: 4, averageCost: 50,
    tags: [], photos: [], dataCompleteness: 60, status: "potential", reasons: [], fetchedAt: "2026-09-23",
    ...overrides,
  };
}

try {
  const { calculateRecommendationScore } = await server.ssrLoadModule("/lib/recommendation-score.ts");
  const target = restaurant("target");
  const sample = restaurant("sample");
  const score = (samples) => calculateRecommendationScore(target, {
    allRestaurants: [target, sample], preferenceSamples: samples,
  });
  const base = score([]);
  const liked = score([{ restaurant: sample, feedback: "liked" }]);
  const wanted = score([{ restaurant: sample, feedback: "want" }]);
  const average = score([{ restaurant: sample, feedback: "average" }]);
  const closed = score([{ restaurant: sample, labels: ["blacklist"], reasons: ["closed"] }]);
  const expensive = score([{ restaurant: sample, labels: ["blacklist"], reasons: ["expensive"] }]);
  const self = score([{ restaurant: target, feedback: "liked" }]);

  assert.ok(liked.score > wanted.score && wanted.score >= base.score);
  assert.ok(average.score < base.score);
  assert.equal(closed.score, base.score);
  assert.equal(self.score, base.score);
  assert.ok(expensive.personalEvidence.every((item) => item.label === "相近人均消费偏好"));
  assert.ok(liked.personalAdjustment <= 10);
  assert.equal(liked.baseScore, base.score);
  console.log("个性化评分测试通过：正负反馈、屏蔽原因、自身样本和加分上限");
} finally {
  await server.close();
}
