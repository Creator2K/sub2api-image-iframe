# Sub2API Image Iframe

Sub2API 自定义 iframe 在线生图页面，包含前端页面和后端代理。

- 默认黑夜模式
- 固定模型: `gpt-image-2`
- 支持图片生成和图片编辑
- 使用 iframe 传入的用户 `token`，不需要 admin-key
- 使用用户自己的 Sub2API API Key 调用 OpenAI-compatible 图片接口
- 保留最近生成历史

## API

后端会调用图片出口:

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `GET /v1/models`

当前密钥必须只返回一个模型: `gpt-image-2`。

## 配置

```bash
cp .env.example .env
```

```env
IMAGE_APP_PORT=8787
IMAGE_APP_PUBLIC_BASE_URL=https://your-app.example.com
IMAGE_APP_CORS_ORIGINS=https://your-sub2api.example.com

SUB2API_BASE_URL=https://your-sub2api.example.com
SUB2API_IMAGE_GROUP_ID=3
SUB2API_IMAGE_KEY_NAME=OpenAI生图
SUB2API_AUTO_CREATE_KEY=true

CHATGPT2API_BASE_URL=https://your-chatgpt2api.example.com
CHATGPT2API_TIMEOUT_MS=180000
```

- `SUB2API_IMAGE_GROUP_ID`: 生图分组 ID。
- 如果图片出口就是 Sub2API 网关，`CHATGPT2API_BASE_URL` 可以和 `SUB2API_BASE_URL` 相同。
- `.env` 不要提交到仓库。

## 开发

```bash
npm install
npm run dev
```

- 前端: `http://localhost:5179`
- 后端: `http://localhost:8787`

Windows:

```powershell
.\dev-start.bat
.\dev-stop.bat
```

## 构建运行

```bash
npm run build:all
npm start
```

## Sub2API 自定义菜单

自定义 iframe URL 填:

```text
https://your-app.example.com/
```

Sub2API 会自动追加 `user_id`、`token` 等参数。
