<p align="center">
  <img src="frontend/public/favicon.svg" width="88" alt="szyca logo" />
</p>

<h1 align="center">szyca</h1>

<p align="center">
  <strong>汕头职业技术学院计算机协会官网与招新答题系统</strong>
</p>

<p align="center">
  <a href="deploy/Dockerfile"><img src="https://img.shields.io/badge/Go%20build-1.27-00ADD8?logo=go&amp;logoColor=white" alt="Go 1.27 build image" /></a>
  <a href="frontend/package.json"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&amp;logoColor=061A2B" alt="React 18" /></a>
  <a href="deploy/Dockerfile"><img src="https://img.shields.io/badge/Deploy-single%20container-2496ED?logo=docker&amp;logoColor=white" alt="Single container deployment" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Lzf07123/szyca" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="#核心能力">核心能力</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#架构概览">架构</a>
  ·
  <a href="#开发与验证">开发</a>
  ·
  <a href="#运维要点">部署</a>
  ·
  <a href="#文档索引">文档</a>
</p>

项目以「数字深空 · 代码即美学」为视觉语言，覆盖数据驱动首页、现场答题、实时排行榜、大屏、抽奖、加入方式、活动图集与权限化后台。

技术上采用 **Go 1.27 + PostgreSQL + Redis + React 18 + Vite 8 + Nginx**。生产形态固定为**单镜像、单容器、单数据卷**，PostgreSQL、Redis、Go 和 Nginx 均由同一容器管理。

## 文档索引

| 文档 | 内容 |
|---|---|
| [架构与模块](docs/架构与模块.md) | 运行形态、模块边界、生命周期与请求链路 |
| [模块开发契约](docs/模块开发契约.md) | 新增或修改模块的权威规则 |
| [Section 插件开发](docs/Section插件开发.md) | 首页 Section 的 Manifest、配置与版本迁移 |
| [API](docs/API.md) | 公开接口、后台接口、错误码与关键约束 |
| [后台操作手册](docs/后台操作手册.md) | 管理员日常操作 |
| [部署与回滚](docs/部署与回滚.md) | 生产配置、备份、迁移、发布和回滚 |
| [验收报告](docs/验收报告.md) | 功能、安全、迁移与浏览器验收记录 |

## 核心能力

- **数据驱动站点**：`/api/site` 一次返回品牌、导航、页脚、功能开关、首页 Section、背景和二维码；首页同一 Section 类型支持多实例编排。
- **在线答题**：一人一设备一身份，服务端持久化题序与截止时间，正确答案不下发，提交使用 `request_id` 幂等。
- **实时排行与大屏**：按最佳成绩与用时排序，WebSocket 推送排行、公告、特效和号码开奖状态。
- **现场抽奖**：支持号码大屏逐级开奖和个人抽取；使用 CSPRNG 加权抽取，库存、记录与幂等约束在事务内完成。
- **后台安全**：固定角色权限、HttpOnly/SameSite 会话、Origin 与 CSRF 校验、登录限流及后台写操作审计。
- **内容与媒体**：页面、二维码、背景、Logo、页脚、活动图集均可在后台维护；媒体引用检查阻止误删。
- **可验证交付**：版本化 SQL 迁移、迁移校验和、定向测试、隔离集成测试和 Playwright 浏览器验收。

## 架构概览

```text
访客浏览器
    │ HTTP / WebSocket :8080
    ▼
容器内 Nginx
    ├─ React 静态资源
    ├─ /api ──────────────► Go :8081
    └─ /ws  ──────────────► Go :8081
                              ├─ PostgreSQL :5432（容器回环）
                              └─ Redis :6379（容器回环）

持久化卷 szyca_data
    ├─ PostgreSQL 数据
    ├─ Redis AOF
    └─ 上传文件
```

模块在构建期合并进同一个 Go 二进制和 React 产物，不支持运行期下载、热插拔或远程脚本。

### 业务模块

| 模块 | 职责 | 依赖 |
|---|---|---|
| `quiz` | 身份、题库、轮次、作答、成绩、排行数据 | 无 |
| `lottery` | 号码开奖、个人抽奖、奖品、库存与领取 | `quiz` |
| `screen` | 排行榜 API 与现场大屏 | `quiz`、`realtime` |
| `realtime` | WebSocket、公告、特效 | `quiz` |
| `join` | 加入页面与二维码 | 无 |
| `gallery` | 活动图集及 Section 编辑器 | 无 |

`modules/<key>/module.json` 是模块元数据的事实源。修改 Manifest、迁移、模块入口或模块样式后，必须重新生成注册产物；不要手工编辑 `*.generated.*` 文件。

## 快速开始

### 前置条件

- Docker Engine 与 Docker Compose v2。
- 至少 1 GB 可用内存。
- 生产环境需准备域名、TLS 终止和外部反向代理。

### 使用预构建镜像

在仓库根目录执行：

```bash
cp .env.example .env
```

编辑 `.env`，至少完成以下配置：

```dotenv
ADMIN_PASSWORD=<首次启动使用的强口令>
POSTGRES_PASSWORD=<数据库强口令>
SZYCA_IMAGE_REGISTRY=registry.example.com/
SZYCA_IMAGE=szyca:latest
SZYCA_PULL_POLICY=always
```

`SZYCA_IMAGE_REGISTRY` 必须以 `/` 结尾；最终镜像地址为两者直接拼接。若镜像位于本机，可不设置 registry，并将拉取策略设为 `missing`。

随后启动：

```bash
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps
```

服务就绪后可访问：

| 地址 | 用途 |
|---|---|
| `http://localhost:8080/` | 首页 |
| `/about` | 关于协会 |
| `/quiz`、`/result` | 答题与个人成绩 |
| `/screen` | 实时排行榜大屏 |
| `/lottery` | 号码抽奖大屏 |
| `/lottery/participate` | 答题后的个人抽奖 |
| `/join` | 加入方式 |
| `/admin` | 后台管理 |
| `/healthz`、`/readyz` | 存活与就绪检查 |

页面是否公开由后台功能开关和 Section 配置决定。

### 本地构建

开发机从源码构建并启动：

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.build.yml \
  up -d --build
```

源码通过构建阶段写入镜像，不会热更新到运行中的容器。修改代码后需要重新构建；执行前应确认不会覆盖生产数据。

停止服务：

```bash
docker compose -f deploy/docker-compose.yml down
```

普通 `down` 会保留 `szyca_data`。`down -v` 会删除数据库、Redis 和上传文件，只能在已确认的隔离环境或已有可恢复备份时使用。

## 配置

`.env` 不入库，完整模板见 [.env.example](.env.example)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WEB_PORT` | `8080` | 宿主机对外端口 |
| `ADMIN_USERNAME` | `owner` | 首次启动创建的 owner 用户名 |
| `ADMIN_PASSWORD` | `admin123` | 首次创建 owner 的口令，至少 8 个字符；已有账号不会在重启时被覆盖 |
| `ADMIN_COOKIE_SECURE` | `false` | 后台 Cookie 仅通过 HTTPS 发送；生产必须为 `true` |
| `ADMIN_SESSION_HOURS` | `8` | 后台会话有效时长 |
| `LEGACY_ADMIN_TOKEN_ENABLED` | `false` | 旧单口令迁移窗口；完成切换后必须关闭 |
| `POSTGRES_PASSWORD` | `szyca` | PostgreSQL 口令；首次初始化数据卷后，修改前需同步处理现有数据库 |
| `QUESTION_SECONDS` | `20` | 每题服务端作答时限，单位秒 |
| `ANSWER_GRACE_SECONDS` | `20` | 断线补交宽限，单位秒 |
| `QUESTION_COUNT` | `10` | 每轮抽题数 |
| `PG_POOL_MAX` | `20` | PostgreSQL 连接池上限 |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.1/32,::1/128` | 允许透传来源地址的代理网段，逗号分隔 |
| `WS_ALLOWED_ORIGINS` | 空 | 同源之外的 WebSocket Origin 白名单，逗号分隔 |
| `SZYCA_IMAGE_REGISTRY` | 空 | 预构建应用镜像仓库前缀，需以 `/` 结尾 |
| `SZYCA_IMAGE` | `szyca:latest` | 应用镜像名与 tag |
| `SZYCA_PULL_POLICY` | `missing` | Compose 镜像拉取策略；固定发布可使用 `always` |
| `BASE_IMAGE_REGISTRY` | 空 | 仅开发构建使用的 Go/Node/Alpine 基础镜像前缀 |
| `SOURCE_MIRROR` | 空 | 仅开发构建使用；设为 `cn` 时启用国内软件源 |

生产保护规则：当 `ADMIN_COOKIE_SECURE=true` 时，默认管理员口令、默认数据库口令或未关闭的旧口令入口都会使容器拒绝启动。

后台内容、功能开关、首页 Section、二维码、背景、Logo 和页脚保存在数据库或上传目录中，不要通过修改源码代替后台配置。

## 目录结构

```text
backend/
  cmd/server/          Go 服务入口
  contract/            跨层公共契约
  core/                HTTP、权限、审计、媒体、站点、迁移和模块运行时
modules/               六个业务模块及其 Manifest、迁移、前端和测试
frontend/              React 站壳、共享组件、Section runtime 和 API 客户端
cmd/modulegen/         Manifest 与迁移注册生成器
deploy/                Dockerfile、Compose、Nginx、Supervisor 和入口脚本
design-system/szyca/   项目自有深空品牌与模板快照
docs/                  架构、API、开发、运维和验收文档
scripts/               集成、迁移、备份恢复、模板检查与发布脚本
loadtest/              k6 压测场景
tests/browser/         Playwright + axe 浏览器验收
```

## 开发与验证

所有编译、生成和测试命令都在挂载源码的容器内执行，不依赖宿主机 Go、Node 或 Python 工具链。当前运行中的 `szyca` 服务只挂载数据卷，不挂载源码。

### 常用检查

```bash
# 单个 Go 包
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go test ./modules/quiz/backend

# 前端类型检查与生产构建
# 首次使用或 package-lock.json 变更后，先执行 npm ci
docker run --rm -v "$PWD:/src" -w /src/frontend node:24-alpine \
  npm run build

# Manifest、迁移或模块入口变更
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go run ./cmd/modulegen --write
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go run ./cmd/modulegen --check

# 共享视觉令牌变更
docker run --rm -v "$PWD:/src" -w /src python:3.12-alpine \
  python3 scripts/export_design_template.py --check
```

依赖安装示例：

```bash
docker run --rm -v "$PWD:/src" -w /src/frontend node:24-alpine \
  npm ci --no-audit --no-fund
```

项目没有 ESLint、Prettier、golangci-lint 或 CI 配置，不要虚构这些命令。

### 修改模块

1. 阅读对应 `module.json`、后端路由/service/repository、前端入口和 `tests/browser.mjs`。
2. 先明确模块所有权，跨模块协作使用 `backend/contract` 或已声明的窄接口。
3. 同时检查 Manifest、实际路由、权限、前端入口、测试和必要文档是否一致。
4. Manifest、迁移或模块样式变化后运行 `modulegen --write`，再运行 `modulegen --check`。
5. 只运行与改动直接相关的包测试或前端构建；任务收尾再运行完整验证。

### 完整验证

宣布交付前执行一次：

```bash
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine go test ./...
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine go vet ./...
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go run ./cmd/modulegen --check
docker run --rm -v "$PWD:/src" -w /src/frontend node:24-alpine \
  npm run build
```

失败后只重跑失败项。同一命令连续失败两次时，应先分析执行位置、依赖和失败原因，不要机械重跑。

### 隔离集成测试

集成脚本默认访问 `http://localhost:8091`，并共享同一套测试状态，必须按以下顺序执行：

```bash
WEB_PORT=8091 ADMIN_PASSWORD=integrity-test \
QUESTION_SECONDS=5 ANSWER_GRACE_SECONDS=2 \
docker compose -p stpt-integrity-test \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.build.yml \
  up -d --build

python3 scripts/integration_test.py
python3 scripts/admin_access_test.py
python3 scripts/site_media_test.py
python3 scripts/lottery_test.py
python3 scripts/lottery_number_test.py
python3 scripts/migration_test.py
python3 scripts/site_perf_test.py
```

测试栈使用独立项目名和端口。结束并清理测试数据前，必须先确认 `stpt-integrity-test` 与实际运行服务无关。

浏览器验收、迁移回归、备份恢复和压测命令见[部署与回滚手册](docs/部署与回滚.md)、[验收报告](docs/验收报告.md)与 [k6 场景](loadtest/k6-loadtest.js)。

## 运维要点

- 数据全部存放在 `szyca_data` 单卷；升级或迁移前先完成整卷备份。
- 容器只对外暴露 `8080`；PostgreSQL 与 Redis 只监听容器回环地址。
- 外部反向代理必须透传 `Host`、`X-Forwarded-*` 以及 WebSocket `Upgrade`、`Connection` 头。
- 健康检查使用 `/healthz` 和 `/readyz`；业务可用性还应检查 `/api/site`、答题写入和 WebSocket。
- 发布前切换 `ADMIN_COOKIE_SECURE=true`、更换默认口令、关闭旧口令入口，并验证四种后台角色。
- 迁移失败时保留日志和 `schema_migrations` 状态，先分析最后成功版本；禁止修改已应用迁移。

备份、恢复、发布顺序和镜像回滚以[部署与回滚手册](docs/部署与回滚.md)为准。

## 参与贡献

欢迎提交问题与改进：

- 功能改动先阅读[模块开发契约](docs/模块开发契约.md)，保持 Manifest、路由、前端入口、权限、测试与生成文件一致。
- 首页 Section 和公开 API 改动分别遵循 [Section 插件开发](docs/Section插件开发.md) 与 [API](docs/API.md)。
- 不要手工编辑 `*.generated.*`，不要提交 `node_modules/`、构建产物、上传文件、日志或真实用户数据。
- 提交前执行[完整验证](#完整验证)，并说明改动范围、验证命令和已知边界。
- 安全问题不要携带真实密钥、管理员口令或用户数据进入公开 Issue。

## License

[MIT](LICENSE) © 2026 黎智锋（Li Zhifeng）
