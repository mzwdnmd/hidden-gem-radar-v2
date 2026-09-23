# 小馆雷达 V5

基于高德真实地图和真实 POI 数据发现附近餐馆的开源应用。项目支持按地图可视范围均匀搜索、候选分筛选、黑名单与连锁品牌屏蔽、人工偏好标注，以及评论截图证据的浏览器本地保存。

## 在线访问

[打开 GitHub Pages 网页](https://mzwdnmd.github.io/hidden-gem-radar-v2/)

## 主要能力

- GitHub Pages 版本使用高德 JS API 的真实地图与真实 POI；本地 Next 版本还可使用 Web Service 接口
- 根据缩放等级对可视地图进行矩形网格搜索
- 请求串行节流、缓存、POI 去重与屏幕密度均匀化
- 地图、列表和分屏三种结果视图
- 候选分门槛与可解释评分证据
- 根据个人标注调整候选分，展示基础分和个性化加减分；单条标注影响有限
- 用品店、公司等非餐馆及茶府、棋牌等娱乐场所默认屏蔽；支持查看已屏蔽结果并纠正误判
- “想去”等人工标签及 JSON 导出、旧标注导入、完整备份和迁移
- 评论来源链接、截图和人工核对文字的浏览器本地存储

## 个性化排序

“吃过且好吃”是较强的正面信号，“想去”是较弱的兴趣信号；“吃过但一般”和“不感兴趣”是负面信号。同类餐馆、相近人均消费和同商圈的标注会对 V4 基础分产生最多约 ±10 分的修正。详情页展示每项修正及参与计算的标注数量。单店、连锁和娱乐场所屏蔽仍由明确规则处理；店铺关闭、重复 POI、信息错误等原因不会被泛化为菜系偏好。反馈快照随完整备份导出，换一次搜索范围后依然可用。当前阶段使用可解释规则，尚未启用机器学习模型。

## 从本地版迁移数据

1. 在原来使用的浏览器中打开本地版，点击顶部 **完整备份**，保存 JSON 文件。它包含标签、品牌黑名单、偏好、评论文字及截图。
2. 打开上方 GitHub Pages 网页，点击 **导入备份**，选择刚保存的 JSON 文件。
3. 网页会将备份与当前浏览器已有记录合并，并自动刷新。旧版 **导出标注** 文件也可以导入，但其中没有评论截图、偏好等完整数据。

浏览器按网站地址隔离本地存储，所以本地版的数据不会自动出现在 Pages。备份文件只在你的浏览器中读取，不会上传到 GitHub。

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

回归测试：`node tests/recommendation-score.test.mjs`、`node tests/restaurant-filter.test.mjs`。

## 开源协议

[MIT](LICENSE)
