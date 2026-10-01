# 小馆雷达

基于高德真实地图和真实 POI 数据发现附近餐馆的开源应用。项目支持按地图可视范围均匀搜索、候选分筛选、黑名单与连锁品牌屏蔽、人工偏好标注，以及评论截图证据的浏览器本地保存。

## 在线访问

[打开 GitHub Pages 网页](https://mzwdnmd.github.io/hidden-gem-radar-v2/)

## 主要能力

- GitHub Pages 版本使用高德 JS API 的真实地图与真实 POI；本地 Next 版本还可使用 Web Service 接口
- 根据缩放等级对可视地图进行矩形网格搜索
- 请求串行节流、缓存、POI 去重与屏幕密度均匀化
- 地图、列表和分屏三种结果视图
- 候选分门槛与可解释评分证据
- 自定义人均消费下限、上限，可选择是否包含人均未知的店
- 店名定向查找：按填写的城市检索当前地图范围外的高德餐饮 POI，查找结果可直接标注
- 根据分享的「训练用专辑」及个人标注学习口味、人均、商圈权重，展示基础分和加减分
- 蛋糕、用品店、公司等非餐馆及茶府、棋牌等娱乐场所默认屏蔽；支持查看已屏蔽结果并纠正误判
- 截至 2026-10-01，店主截图中的 16 个连锁品牌已写入公共屏蔽名单，对所有访问者生效；新的个人标记仍只保存在各自浏览器
- “想去”等人工标签及 JSON 导出、旧标注导入、完整备份和迁移
- 评论来源链接、截图和人工核对文字的浏览器本地存储

## 个性化排序

[风谣分享的「训练用专辑」](https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=14314835&shareid=OZhGaDRi1E_1790849820)包含 20 家「吃过且好吃」餐馆，已作为内置训练样本。16 家依据名称、门店和地区核准了高德 POI ID；另外 4 家仍保留口味标签，但不关联可能错误的高德门店。内置名单对所有访问者生效，本机明确标注可覆盖它。

轻量偏好模型把内置名单和浏览器中已有的「吃过且好吃」一起作为正样本，在当前搜索结果中对比相似口味、人均价位和商圈的出现频率，自适应调整这三个特征的权重。模型对「想去」使用弱正反馈，对「吃过但一般」和「不感兴趣」使用负反馈。核准门店或本机喜欢的门店额外加 2.5 分；偏好总修正限制在 -4 到 +5.5 分，不改变 V4 反平台推荐基础分和明确屏蔽规则。详情页逐项展示证据。样本量仍小，结果是可解释的偏好微调，并不代表对餐馆品质的客观预测。

反馈快照随完整备份导出，换一次搜索范围后依然可用。店铺关闭、重复 POI、信息错误等屏蔽原因不会被泛化为口味偏好。

## 从本地版迁移数据

1. 在原来使用的浏览器中打开本地版，点击顶部 **完整备份**，保存 JSON 文件。它包含标签、品牌黑名单、偏好、评论文字及截图。
2. 打开上方 GitHub Pages 网页，点击 **导入备份**，选择刚保存的 JSON 文件。
3. 网页会将备份与当前浏览器已有记录合并，并自动刷新。旧版 **导出标注** 文件也可以导入，但其中没有评论截图、偏好等完整数据。

浏览器按网站地址隔离本地存储，所以本地版的数据不会自动出现在 Pages。备份文件只在你的浏览器中读取，不会上传到 GitHub。

## 查找与筛选

在顶部输入店名后点击“搜店铺”，会按地图筛选栏中的城市查找；城市留空则进行全国关键词查找。定向查找取高德返回的前 50 条餐饮结果，包含当前地图外或被候选规则屏蔽的店，便于核对和标注。点击“返回地图候选”后，重新按可视范围搜索。人均消费区间只作用于普通候选；启用区间后，人均未知的店默认不显示，可在筛选面板中勾选包含。

## 数据和隐私

- 仓库不包含高德密钥，`.env.local` 已由 `.gitignore` 排除。
- Web Service Key 仅在本地 Next 服务端使用，不会进入 Pages 构建产物。
- `NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` 会随 Pages 前端代码公开；请在高德控制台允许 `mzwdnmd.github.io` 域名。
- 评论证据和人工偏好默认保存在访问者自己的浏览器中，不上传到仓库。
- 高德 JS API 有时不返回评分或人均消费；这类字段显示为“暂无”，候选分保持低证据置信度。Pages 不会用模拟值补齐。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
corepack enable
pnpm install
copy .env.example .env.local
pnpm dev
```

环境变量：

```text
NEXT_PUBLIC_AMAP_JS_KEY=
NEXT_PUBLIC_AMAP_SECURITY_JS_CODE=
AMAP_WEB_SERVICE_KEY=
```

## GitHub Pages 部署

Pages 从 `gh-pages` 分支发布。构建命令是 `node node_modules/vite/bin/vite.js build --config vite.pages.config.ts`，产物位于 `dist-pages`。构建环境需提供 `NEXT_PUBLIC_AMAP_JS_KEY` 与 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`。本地 Next 版本仍可使用 `AMAP_WEB_SERVICE_KEY`。

回归测试：`node tests/recommendation-score.test.mjs`、`node tests/restaurant-filter.test.mjs`、`node tests/shop-search.test.mjs`。

## 开源协议

[MIT](LICENSE)
