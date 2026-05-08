# Sub2API Image Iframe

一个可嵌入 Sub2API 自定义 iframe 菜单的在线生图页面。

项目包含前端和后端：

- 前端：简洁白色 UI，支持图片生成、图片编辑、最近生成历史。
- 后端：使用 iframe 传入的 Sub2API 用户 token 获取用户信息和用户自己的 API Key。
- 图片出口：兼容 OpenAI 图片接口，例如 `chatgpt2api` 暴露的：
  - `POST /v1/images/generations`
  - `POST /v1/images/edits`

> 默认模型固定为 `gpt-image-2`，前端不提供模型选择。

## 功能

- 自动读取 Sub2API iframe 参数：`user_id`、`token`、`theme`、`lang`
- 自动获取当前用户信息、余额、生图分组
- 自动获取或创建当前用户自己的 Sub2API API Key
- 自动获取失败时支持用户手动填写 API Key
- 手动 API Key 仅保存到浏览器 `localStorage`
- 保留最近生成图片历史
- 支持开发用一键启动 / 关闭 bat 脚本

## 工作方式

Sub2API 自定义 iframe 页面会在 URL 后追加：

```text
?user_id=<当前用户ID>&token=<JWT>&theme=light&lang=zh&ui_mode=embedded
```

本应用后端会使用该用户 JWT：

1. 调用 Sub2API `/api/v1/user/profile` 校验用户。
2. 调用 `/api/v1/groups/available` 查找当前用户可用的 OpenAI 生图分组。
3. 调用 `/api/v1/keys` 查找该用户自己的 API Key。
4. 如果没有可用 Key，调用用户接口 `POST /api/v1/keys` 创建。
5. 用该用户 API Key 请求图片出口 `/v1/images/*`。

本项目不需要也不保存 Sub2API `admin-key`。

## 前置要求

请先在 Sub2API 后台准备一个用户可见的 OpenAI 生图分组：

- `platform`: `openai`
- `status`: `active`
- 开启图片生成能力：`allow_image_generation`
- 建议名称：`OpenAI生图`

如果该分组是订阅分组，用户必须拥有有效订阅，否则用户侧 `/groups/available` 看不到该分组。

## 安装

```bash
git clone https://github.com/creator2k/sub2api-image-iframe.git
cd sub2api-image-iframe
npm install
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
copy .env.example .env
```

## 配置

编辑 `.env`：

```env
IMAGE_APP_PORT=8787
IMAGE_APP_HOST=0.0.0.0
IMAGE_APP_DATA_DIR=./data
IMAGE_APP_PUBLIC_BASE_URL=https://your-image-app.example.com
IMAGE_APP_CORS_ORIGINS=https://your-sub2api.example.com

SUB2API_BASE_URL=https://your-sub2api.example.com
SUB2API_IMAGE_GROUP_NAME=OpenAI生图
SUB2API_IMAGE_KEY_NAME=OpenAI生图
SUB2API_AUTO_CREATE_KEY=true

CHATGPT2API_BASE_URL=https://your-chatgpt2api.example.com
CHATGPT2API_TIMEOUT_MS=180000
```

说明：

- 如果你的图片出口就是 Sub2API 网关本身，可以把 `CHATGPT2API_BASE_URL` 设置为 Sub2API 域名。
- `SUB2API_AUTO_CREATE_KEY=true` 表示当前用户没有该分组 API Key 时自动创建。
- 没有 `admin-key`，所以本项目不会自动创建全局分组。

## 开发运行

```bash
npm run dev
```

默认地址：

- 前端：`http://localhost:5179`
- 后端：`http://localhost:8787`

Windows 开发脚本：

```powershell
.\dev-start.bat
.\dev-stop.bat
```

## 生产构建

```bash
npm run build:all
npm start
```

构建后后端会托管 `dist/public` 中的前端文件。

## 配置到 Sub2API

在 Sub2API 管理后台添加自定义菜单：

- 标题：`在线生图`
- 可见性：普通用户
- URL：`https://your-image-app.example.com/`

Sub2API 会自动追加 iframe 参数，用户进入后即可使用。

## 项目结构

```text
backend/
  server.ts       # API 服务
  sub2api.ts      # Sub2API 用户接口集成
  chatgpt2api.ts  # OpenAI 图片接口代理
  history.ts      # 最近生成历史
frontend/
  src/App.vue     # 前端页面
  src/style.css   # 页面样式
```

## 安全说明

- 不要把 `.env` 提交到仓库。
- 手动 API Key 只存储在浏览器 localStorage。
- 后端不会持久化保存用户手动填写的 API Key。
- 用户历史只保存图片 URL / data URL 引用和提示词等元数据。

## License

MIT
