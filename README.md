# Sub2API Image Iframe

Sub2API 自定义 iframe 在线生图页面。页面风格为深色工作台，支持文生图、图生图、API Key 选择、生成历史和多图预览。

项目现在保留一个轻量后端代理：前端只创建图片任务，后端在后台调用 Sub2API 的 OpenAI-compatible 图片接口，前端轮询任务结果。这样可以避免 Cloudflare、Nginx 或浏览器等待长请求时超时。

## 功能

- 固定模型：`gpt-image-2`
- 固定质量：`1K`
- 支持文生图：`/v1/images/generations`
- 支持图生图：`/v1/images/edits`
- 使用 iframe 传入的 `user_id` 和 `token` 校验当前 Sub2API 用户
- 使用用户自己的 Sub2API API Key 生成图片，不需要 admin key
- 自动获取或创建指定生图分组下的 API Key
- 后端异步 job 执行图片任务，前端轮询 `jobId`
- 最近生成历史保留 1 天
- 历史图片通过后端代理展示，减少跨域和原始 URL 失效带来的问题

## 架构

```text
Sub2API 自定义菜单 iframe
        |
        | user_id / token
        v
前端 Vue 页面
        |
        | 创建任务: /api/images/*/jobs
        v
Fastify 后端 job 队列
        |
        | 用户自己的 Sub2API API Key
        v
SUB2API_BASE_URL/v1/images/generations
SUB2API_BASE_URL/v1/images/edits
```

后端只调用 `SUB2API_BASE_URL`，不再需要 `CHATGPT2API_BASE_URL` 或其他独立图片出口配置。

## 环境要求

- Node.js 20 或更高版本，建议 Node.js 22
- npm
- 已部署好的 Sub2API 实例
- Sub2API 中有可用的 OpenAI 生图分组，且该分组只返回 `gpt-image-2`

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

示例配置：

```env
IMAGE_APP_PORT=8787
IMAGE_APP_HOST=0.0.0.0
IMAGE_APP_DATA_DIR=./data
IMAGE_APP_PUBLIC_BASE_URL=https://your-image-app.example.com
IMAGE_APP_CORS_ORIGINS=https://your-sub2api.example.com

SUB2API_BASE_URL=https://your-sub2api.example.com
SUB2API_IMAGE_GROUP_NAME=OpenAI生图
SUB2API_IMAGE_GROUP_ID=3
SUB2API_IMAGE_KEY_NAME=OpenAI生图
SUB2API_AUTO_CREATE_KEY=true
IMAGE_APP_REQUEST_TIMEOUT_MS=180000
```

配置说明：

- `IMAGE_APP_PORT`：本服务监听端口，默认 `8787`
- `IMAGE_APP_HOST`：监听地址，服务器部署通常用 `0.0.0.0`
- `IMAGE_APP_DATA_DIR`：历史数据目录，默认 `./data`
- `IMAGE_APP_PUBLIC_BASE_URL`：公网访问地址，用于生成历史图片代理链接
- `IMAGE_APP_CORS_ORIGINS`：允许访问后端 API 的 Sub2API 域名，多个域名用英文逗号分隔
- `SUB2API_BASE_URL`：Sub2API 服务地址，图片生成、图片编辑、模型校验都走这里
- `SUB2API_IMAGE_GROUP_ID`：Sub2API 生图分组 ID
- `SUB2API_IMAGE_GROUP_NAME`：前端显示用的生图分组名称
- `SUB2API_IMAGE_KEY_NAME`：自动创建用户 API Key 时使用的名称
- `SUB2API_AUTO_CREATE_KEY`：用户没有生图分组 Key 时是否自动创建
- `IMAGE_APP_REQUEST_TIMEOUT_MS`：后端调用 Sub2API 图片接口的超时时间，默认 `180000`

不要提交 `.env` 到仓库。

## 本地开发

安装依赖：

```bash
npm install
```

启动前后端开发服务：

```bash
npm run dev
```

默认地址：

- 前端：`http://localhost:5179`
- 后端：`http://localhost:8787`

Vite 会把 `/api` 代理到本地后端。

Windows 可使用：

```powershell
.\dev-start.bat
.\dev-stop.bat
```

## 构建

```bash
npm run build:all
```

构建产物：

- 前端：`dist/public`
- 后端：`dist/backend`

启动生产服务：

```bash
npm start
```

也可以使用仓库内脚本：

```bash
./start.sh
./stop.sh
```

`start.sh` 会读取项目根目录下的 `.env`，并把日志写入 `app.log`。

## 服务器部署

以下示例假设部署目录为 `/opt/sub2api-image-iframe`，域名为 `image.example.com`。

### 1. 拉取代码

```bash
cd /opt
git clone https://github.com/Creator2K/sub2api-image-iframe.git
cd sub2api-image-iframe
```

### 2. 安装依赖

```bash
npm install
```

### 3. 写入配置

```bash
cp .env.example .env
nano .env
```

至少需要修改：

```env
IMAGE_APP_PUBLIC_BASE_URL=https://image.example.com
IMAGE_APP_CORS_ORIGINS=https://your-sub2api.example.com
SUB2API_BASE_URL=https://your-sub2api.example.com
SUB2API_IMAGE_GROUP_ID=3
```

### 4. 构建并启动

```bash
npm run build:all
chmod +x start.sh stop.sh
./start.sh
```

检查服务：

```bash
curl http://127.0.0.1:8787/api/health
```

正常返回：

```json
{"ok":true}
```

### 5. 配置 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name image.example.com;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果使用 HTTPS，建议用 Certbot 或面板配置证书。Cloudflare 可开启代理；图片生成请求本身走 job 创建和轮询，不依赖 Cloudflare 长连接等待。

### 6. 配置 Sub2API 自定义菜单

在 Sub2API 后台添加自定义 iframe 菜单，URL 填：

```text
https://image.example.com/
```

Sub2API 会自动追加 `user_id`、`token`、`src_host` 等参数。页面会用这些参数校验当前用户并调用后端 API。

## 更新部署

```bash
cd /opt/sub2api-image-iframe
git pull
npm install
npm run build:all
./stop.sh
./start.sh
```

检查健康状态：

```bash
curl http://127.0.0.1:8787/api/health
```

## API 说明

用户侧接口：

- `GET /api/session`：校验 iframe 用户，返回用户信息、API Key 和历史
- `POST /api/keys`：为当前用户创建生图分组 API Key
- `GET /api/keys/:id/models`：检查所选 API Key 是否支持 `gpt-image-2`
- `GET /api/history`：读取当前用户 1 天内历史
- `GET /api/history/:userId/:itemId/image`：代理历史图片
- `POST /api/images/generations/jobs`：创建文生图任务
- `POST /api/images/edits/jobs`：创建图生图任务
- `GET /api/jobs/:id`：轮询任务状态和结果

图片生成实际调用：

- `POST ${SUB2API_BASE_URL}/v1/images/generations`
- `POST ${SUB2API_BASE_URL}/v1/images/edits`
- `GET ${SUB2API_BASE_URL}/v1/models`

## Job 行为

创建任务接口会快速返回：

```json
{
  "job": {
    "id": "job-id",
    "status": "queued"
  }
}
```

前端会轮询 `/api/jobs/:id`，状态包括：

- `queued`
- `running`
- `succeeded`
- `failed`

任务状态保存在当前 Node.js 进程内存中，进程重启后未完成任务会丢失，需要用户重新发起生成。

## 数据和日志

- 历史数据：`data/users/<userId>/history.json`
- 日志文件：`app.log`
- 历史保留策略：只保留 1 天内记录，每个用户最多保留最近 30 条

## 常见问题

### 页面提示“请从 BeeCode后台进入”

说明 URL 中没有 `user_id` 或 `token`。请从 Sub2API 自定义菜单进入，不要直接裸打开页面。

### 提示“此密钥不是正确的分组”

后端会请求 `/v1/models` 校验 API Key。当前要求密钥可用且模型列表只返回 `gpt-image-2`。请检查 `SUB2API_IMAGE_GROUP_ID` 是否对应正确的生图分组。

### 图片编辑经常 504

图生图耗时更长，建议：

- 上传更小的原图
- 使用较小尺寸
- 确认 `IMAGE_APP_REQUEST_TIMEOUT_MS` 足够大
- 检查 Sub2API 上游网关是否也有更短超时

### Cloudflare 超时

前端不会直接等待图片生成完成，只会创建 job 并轮询结果。若仍然看到 Cloudflare 超时，通常是反向代理或上游 Sub2API 的图片接口超时，而不是 iframe 应用创建任务接口超时。

## 许可证

Private project.
