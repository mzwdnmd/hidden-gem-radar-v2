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
  const { calculateRecommendationScore, trainPreferenceWeights } = await server.ssrLoadModule("/lib/recommendation-score.ts");
  const { TRAINING_ALBUM, TRAINING_ALBUM_MATCHED_IDS, trainingAlbumSamples } = await server.ssrLoadModule("/lib/training-album.ts");
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
  assert.ok(self.score > base.score);
  assert.equal(self.personalEvidence[0].label, "已吃过且好吃（本店）");
  assert.ok(expensive.personalEvidence.every((item) => item.label === "相近人均消费偏好"));
  assert.ok(liked.personalAdjustment <= 5.5);
  assert.equal(liked.baseScore, base.score);
  assert.equal(TRAINING_ALBUM.length, 20);
  assert.equal(TRAINING_ALBUM_MATCHED_IDS.size, 16);
  const albumSamples = trainingAlbumSamples({}, new Set());
  assert.equal(albumSamples.length, 20);
  assert.equal(albumSamples.filter((sample) => sample.restaurant.id.startsWith("dianping:")).length, 4);
  const matched = TRAINING_ALBUM.find((entry) => entry.amapId);
  assert.equal(trainingAlbumSamples({ [matched.amapId]: "average" }, new Set()).length, 19);
  const albumRestaurant = restaurant(matched.amapId, { name: matched.amapName, category: matched.cuisine });
  const albumScore = calculateRecommendationScore(albumRestaurant, { allRestaurants: [albumRestaurant], preferenceSamples: albumSamples });
  assert.ok(albumScore.personalAdjustment >= 2.5 && albumScore.personalAdjustment <= 5.5);

  const likedCluster = [restaurant("a", { name: "甲火锅", category: "火锅店" }), restaurant("b", { name: "乙火锅", category: "火锅店" })];
  const diversePool = [restaurant("c", { name: "丙米线" }), restaurant("d", { name: "丁烧烤" }), restaurant("e", { name: "戊面馆" }), restaurant("f", { name: "己汉堡" }), restaurant("g", { name: "庚春卷" })];
  const learned = trainPreferenceWeights(likedCluster.map((item) => ({ restaurant: item, feedback: "liked" })), [...likedCluster, ...diversePool]);
  assert.ok(learned.cuisine > 0.6, "喜欢的店共享火锅特征时，菜系权重应上调");
  assert.ok(Math.abs(Object.values(learned).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9);
  console.log("偏好模型测试通过：正负反馈、专辑 20 家、16 家核准、门店加分与权重学习");
} finally {
  await server.close();
}
