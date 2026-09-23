# 小馆雷达 V5

基于高德真实地图和真实 POI 数据发现附近餐馆的开源应用。项目支持按地图可视范围均匀搜索、候选分筛选、黑名单与连锁品牌屏蔽、人工偏好标注，以及评论截图证据的本地保存。

## 在线访问

部署完成后，公开访问地址会显示在本仓库右侧的 **About / Website** 和 GitHub Actions 的部署记录中。

## 主要能力

- 高德 JS API 真实地图与 Web Service 真实餐饮 POI
- 根据缩放等级对可视地图进行矩形网格搜索
- 请求串行节流、缓存、POI 去重与屏幕密度均匀化
- 地图、列表和分屏三种结果视图
- 候选分门槛与可解释评分证据
- 娱乐场所过滤、单店黑名单和连锁品牌整体屏蔽
- “想去”等人工标签及 JSON 导出
- 评论来源链接、截图和人工核对文字的浏览器本地存储

## 数据和隐私

- 仓库不包含高德密钥，`.env.local` 已由 `.gitignore` 排除。
- Web Service Key 仅在服务端使用。
- `NEXT_PUBLIC_AMAP_JS_KEY` 和 `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` 会随前端代码公开，这是高德 JS API 的正常使用方式；请在高德控制台配置域名白名单。
- 评论证据和人工偏好默认保存在访问者自己的浏览器中，不上传到仓库。

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

## 云端部署

仓库包含 `.github/workflows/deploy-cloudflare.yml`。在 GitHub 仓库中配置以下 Actions Secrets 后，推送到 `main` 会自动部署到 Cloudflare Workers：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEXT_PUBLIC_AMAP_JS_KEY`
- `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE`
- `AMAP_WEB_SERVICE_KEY`

## 开源协议

[MIT](LICENSE)
