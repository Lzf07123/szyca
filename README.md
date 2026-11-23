# szyca

汕头职业技术学院计算机协会官网与招新答题系统：以「数字深空 · 代码即美学」为统一视觉语言，提供数据驱动首页、90 节点引力粒子背景、现场高并发答题、实时计分、全量排行榜、大屏、加入我们、精细后台与集成抽奖。
技术栈：Go 1.22 + gorilla/websocket + Redis + PostgreSQL + React 18 (Vite) + Nginx。
生产环境合并为**单镜像、单容器、单数据卷**；低配机器只拉取预构建镜像，不需要本地编译。

> 架构见 [docs/架构与模块.md](docs/架构与模块.md)，接口见 [docs/API.md](docs/API.md)
>
> Section 插件开发契约见 [docs/Section插件开发.md](docs/Section插件开发.md)
>
> 功能模块开发契约见 [docs/功能模块开发.md](docs/功能模块开发.md)
>
> 后台操作见 [docs/后台操作手册.md](docs/后台操作手册.md)，部署/回滚见 [docs/部署与回滚.md](docs/部署与回滚.md)
>
> 实施基线与验收取证见 [docs/官网重构与抽奖任务书.md](docs/官网重构与抽奖任务书.md)

## 功能一览

- **数据驱动官网**：单次 `/api/site` 获取品牌、导航、页脚、模块开关、Section 插件实例、背景和二维码；同一类型可重复编排，公开站共享 56px 网格、90 节点 Canvas 星座、终端语言和模块卡片布局
- **活动影像**：独立图集数据与专用上传/说明/排序/删除接口，文件接入媒体引用与删除保护，公开端随 `/api/site` 一次返回
- **功能模块边界**：站壳只负责布局、首页、后台与模块组合；答题、加入、抽奖、排行榜通过前后端模块注册表接入，公开导航、路由、API 和懒加载页面由模块 Manifest 贡献
- **在线答题**：一人一设备一身份；难度自选（全部/容易/简单/困难）；每轮题目顺序持久化；只能按当前题序每题提交一次；正确选项不下发前端；服务端按截止时间校验，网络抖动可配置宽限
- **排行榜**：按最佳一轮总分优先、同分按用时排序；全量排名（未答题也排）、大屏最多显示 99 名、头部显示「我的排名」、参与/答题/在线连接统计
- **身份规则**：设备指纹去重（同设备换昵称需先放弃）；放弃身份需二次确认并告知副作用；放弃后昵称永久封存、榜单留痕；可多轮答题取历史最佳成绩
- **后台 2.0**：owner / content_editor / event_operator / data_viewer 固定角色；HttpOnly + SameSite 会话、CSRF、Origin 校验、登录限流和全量写操作审计；菜单按权限生成，接口仍有服务端授权
- **集成抽奖**：独立活动/奖品/抽取/领取数据域；CSPRNG 加权抽取、活动时间与暂停、资格门槛、库存事务、唯一用户约束、`request_id` 幂等、线下领取核销与 CSV
- **迁移与媒体**：版本化 SQL、PostgreSQL advisory lock、事务迁移与校验和；媒体台账记录引用关系，被引用文件禁止直接删除

## 快速开始（低配机器：直接拉取镜像）

```bash
cp .env.example .env
# 编辑 .env：SZYCA_IMAGE_REGISTRY + SZYCA_IMAGE 指向远程仓库，修改 ADMIN_PASSWORD
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```

低配机器运行期只需要镜像 `szyca:latest` 和容器 `szyca`，不会拉取 PostgreSQL、Redis、Nginx 或 Node/Go 基础镜像；这些组件已内置。建议至少 1 GB 内存，生产库存放于 `szyca_data` 单卷。

| 入口 | 说明 |
|---|---|
| http://localhost:8080 | 首页 |
| /quiz | 答题 |
| /result | 个人成绩 |
| /screen | 排行榜大屏（投屏） |
| /lottery | 抽奖（默认关闭） |
| /admin | 后台管理（首次 owner 见 .env） |
| /healthz | 健康检查 |

停止：`docker compose -f deploy/docker-compose.yml down`（加 `-v` 清空数据库与上传文件）。

开发机本地构建使用 build override：

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up -d --build
```

## 环境变量（.env，不入库；模板见 .env.example）

| 变量 | 默认 | 说明 |
|---|---|---|
| `ADMIN_USERNAME` | owner | 首次启动自动创建的 owner 用户名 |
| `ADMIN_PASSWORD` | admin123 | 首次启动创建 owner 的初始密码（务必修改） |
| `ADMIN_COOKIE_SECURE` | false | 后台 Cookie 是否仅 HTTPS 发送；生产必须为 `true` |
| `ADMIN_SESSION_HOURS` | 8 | 后台会话时长 |
| `LEGACY_ADMIN_TOKEN_ENABLED` | false | 旧单口令迁移窗口开关，完成切换后保持关闭 |
| `POSTGRES_PASSWORD` | szyca | 单容器内 PostgreSQL 口令（生产务必修改） |
| `QUESTION_SECONDS` | 20 | 每题倒计时（秒） |
| `ANSWER_GRACE_SECONDS` | 20 | 网络抖动/断线补交宽限（秒）；截止时间本身仍以服务端记录为准 |
| `QUESTION_COUNT` | 10 | 每轮抽题数 |
| `WEB_PORT` | 8080 | 对外端口 |
| `WS_ALLOWED_ORIGINS` | （空） | 额外允许的 WebSocket Origin，逗号分隔；同源与本机开发默认允许 |
| `SZYCA_IMAGE_REGISTRY` | （空） | 应用镜像仓库前缀，需以 `/` 结尾；独立于构建基础镜像 |
| `SZYCA_IMAGE` | szyca:latest | 远程应用镜像名与 tag |
| `SZYCA_PULL_POLICY` | missing | Compose 拉取策略；低配机可设 `always` |

### 远程镜像与本地构建

| 变量 | 默认 | 作用 |
|---|---|---|
| `SZYCA_IMAGE_REGISTRY` | （空） | 最终应用镜像 registry 前缀，与 `SZYCA_IMAGE` 拼接 |
| `BASE_IMAGE_REGISTRY` | （空） | 仅开发构建时替换 golang/node/alpine 基础镜像前缀 |
| `SOURCE_MIRROR` | （空） | 软件源统一开关：空=官方源；`cn`=国内镜像组合（Go 走 goproxy.cn、npm 走 npmmirror、apk 走阿里云） |

示例：远程私有仓库

```bash
SZYCA_IMAGE_REGISTRY=registry.example.com/
SZYCA_IMAGE=szyca:latest
SZYCA_PULL_POLICY=always
```

构建并推送镜像：

```bash
scripts/publish_image.sh          # 构建前可设置 BASE_IMAGE_REGISTRY / SOURCE_MIRROR=cn
scripts/publish_image.sh --push
```

页脚/备案/二维码/背景图/站点 Logo 等运行期内容一律在后台配置，数据库与上传文件统一持久化在 `data` 单卷。

## 后台使用速查

1. 访问 `/admin`，输入 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD` 创建的管理员账号
2. **概览**：单一“下一项操作”焦点、四项紧凑指标；图表、运行状态和终端日志默认折叠、按需展开
3. **答题控制**：开始/结束答题、特效广播、公告广播、二维码管理、成绩导出
4. **题库**：**批量导入**（下载模板，列：题目,选项A~F,正确答案(A-F),难度,分值；「示例」开头行自动跳过）、新增题目、启用/停用
5. **站点内容**：模块总开关、Section 新增/删除/排序/启停、草稿/发布、定时上下线、标题/正文/CTA 配置
6. **抽奖**：总开关、活动开始/暂停/结束、资格、奖品权重与库存、结果查看、领取核销与导出
7. **媒体与外观**：Logo、页脚、背景和媒体引用台账
8. **管理员/审计**：创建角色账号、停用即时踢线、按管理员/资源/请求 ID 查询审计

## 关键 API（全部 JSON；后台接口使用 HttpOnly Cookie + CSRF）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/session | 昵称+设备指纹 → 身份（同设备同昵称自动恢复） |
| GET | /api/site | 公共站点单一配置契约（支持 ETag） |
| GET | /api/content/pages/{slug} | 已发布内容页 |
| POST | /api/quiz/round | 开始一轮（body: difficulty 可选） |
| GET | /api/quiz/current | 恢复进行中的一轮，返回持久化题序与本题截止时间 |
| POST | /api/answer | 提交当前题（request_id 幂等；该轮该题只能计分一次） |
| GET | /api/me | 我的最佳成绩与全量排名 |
| GET | /api/rank?top=99 | 排行榜 |
| GET | /api/stats | 参与人数/累计答题/启用题目数/在线连接数 |
| GET | /api/runtime | 系统运行时长（秒）与启动时间（公开只读） |
| GET | /api/backgrounds · /api/qrcode · /api/config | 前台资源 |
| GET | /ws?token=… | WebSocket 实时推送（匿名=大屏） |
| POST | /api/identity/abandon | 放弃身份（需本机 device_fp 归属校验） |
| GET | /api/lottery/campaign | 当前抽奖活动和用户可见状态 |
| POST | /api/lottery/draw | 带用户 token 与 request_id 抽取 |
| GET | /api/lottery/me | 当前用户抽奖和领取状态 |
| POST | /api/admin/auth/login | 管理员登录，设置 HttpOnly/SameSite Cookie 并返回 CSRF token |
| GET* | /api/admin/auth/me | 当前管理员、角色和权限；刷新 CSRF token |
| GET* | /api/admin/overview | 系统概览 |
| GET* | /api/admin/site/section-plugins | 首页 Section 插件 Manifest |
| GET* | /api/admin/export/scores | 导出成绩 CSV |
| POST* | /api/admin/questions/import | 批量导入题目 CSV |
| GET* | /api/admin/questions/template | 下载导入模板 |
| POST* | /api/admin/{quiz-state,announce,effect,uploads,footer,…} | 后台操作 |
| GET*/POST* | /api/admin/logo | 站点 Logo（读取/保存，空值=恢复内置样式） |
| GET*/POST*/DELETE* | /api/admin/qrcodes[/{id}] | 二维码列表 / 新增 / 改标题与换图 / 启停 / 删除 |

## 目录结构

```
backend/              Go（appmodule/site/access/audit/media/lottery/quiz/platform/store/ws）
frontend/             React 18 + Vite（站壳、Section 插件、功能模块、RBAC 后台）
deploy/               单容器 Dockerfile + Compose + Nginx/Supervisor
design-system/szyca/  BRAND + MASTER + 页面规则 + 项目自有深空模板
docs/                 架构、API、后台、部署回滚与验收证据
tests/browser/        Playwright + axe Docker 验收
artifacts/            本地验收截图与报告（可再生成，不跟踪）
```

## 项目设计模板

`szyca` 的深空视觉独立于 `Li&Design` 子模块，模板版本、权威来源和哈希保存在 `design-system/szyca/template/manifest.json`。

```bash
python3 scripts/export_design_template.py --write
python3 scripts/export_design_template.py --check
```

修改 `frontend/src/index.css` 或 `frontend/src/cosmos.css` 后必须重新导出模板；`--check` 会阻止快照漂移和 `Li&Design` 子模块依赖回流。

## 云端部署要点

- 已备案域名 + 外部反向代理：TLS 在外部反代终止，容器内 Nginx 只走 HTTP；**外部代理仍需透传 WebSocket Upgrade 头**（见 docs §8-§9）
- 前端构建产物建议发布到 OSS+CDN（现场"进门一分钟"静态流量集中）
- 上线前：`.env` 改强口令并设 `ADMIN_COOKIE_SECURE=true` → owner 登录 → 配置站点/抽奖 → 压测 → 现场演练
- 单容器只暴露 8080；PostgreSQL/Redis 仅监听容器回环地址。备份时复制 `szyca_data` 卷即可同时保存数据库、Redis AOF 和上传文件。

## 压测（k6）

```bash
# 隔离环境（独立端口与数据卷，不污染正式数据）
WEB_PORT=8081 ADMIN_PASSWORD=loadtest docker compose -p stpt-loadtest \
  -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up -d --build
# 在 http://localhost:8081/admin 用 owner/loadtest 登录并开始答题
# 运行（400 VU：150 答题全流程 + 200 排行轮询 + 50 WebSocket）
docker run --rm -i --network stpt-loadtest_default \
  -v "$PWD/artifacts/loadtest:/out" \
  -e BASE_URL=http://szyca:8080 \
  -e SUMMARY_PATH=/out/k6-summary.json \
  grafana/k6 run - < loadtest/k6-loadtest.js
docker compose -p stpt-loadtest -f deploy/docker-compose.yml down -v
```

> 注：本机 macOS Docker Desktop 桥接网络对并发吞吐有额外开销；生产 Linux 服务器 + 外部反代网络下指标更优。排行榜主通道为 WS 推送（500ms 节流），轮询仅兜底。

## 开发调试

- 前端热更：`cd frontend && npm run dev`（默认代理到 :8080；对接其他预览栈时可设置 `VITE_DEV_PROXY=http://localhost:8092`）
- 改代码后：`docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up -d --build`
- 查看日志：`docker logs -f szyca`

## 自动化回归（Docker 隔离栈）

```bash
WEB_PORT=8091 ADMIN_PASSWORD=integrity-test \
QUESTION_SECONDS=5 ANSWER_GRACE_SECONDS=2 \
docker compose -p stpt-integrity-test \
  -f deploy/docker-compose.yml -f deploy/docker-compose.build.yml up -d --build
python3 scripts/integration_test.py
docker compose -p stpt-integrity-test -f deploy/docker-compose.yml down -v
```

以下脚本默认连接 `http://localhost:8091`，请按顺序运行；它们共享答题状态，不适合并发执行：

```bash
python3 scripts/integration_test.py
python3 scripts/admin_access_test.py
python3 scripts/site_media_test.py
python3 scripts/lottery_test.py
python3 scripts/migration_test.py
python3 scripts/site_perf_test.py
```

覆盖题目脱敏、题序、幂等、服务端超时、排行榜/导出、并发注册、WS Origin、管理员登录限流、RBAC、CSRF、审计、站点 ETag/模块开关、媒体引用、抽奖资格、同用户并发、库存和领取。后端单测：

```bash
docker run --rm -v "$PWD/backend:/src" -w /src golang:1.22-alpine go test ./...
```

浏览器、无障碍、弱网降级与六档视口：

```bash
docker run --rm -v "$PWD/tests/browser:/work" -w /work \
  mcr.microsoft.com/playwright:v1.56.0-noble npm ci --no-audit --no-fund
docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$PWD/tests/browser:/work" \
  -v "$PWD/artifacts/browser:/artifacts/browser" \
  -w /work \
  -e BASE_URL=http://host.docker.internal:8091 \
  -e ADMIN_PASSWORD=integrity-test \
  mcr.microsoft.com/playwright:v1.56.0-noble node acceptance.mjs
```

旧库升级、整卷备份恢复与版本回滚演练：

```bash
docker build -f deploy/Dockerfile -t szyca:release-test .
python3 scripts/legacy_migration_test.py
python3 scripts/rollback_test.py
python3 scripts/bundle_baseline_test.py
```

备份恢复脚本要求容器名 `szyca` 未被占用；它会创建、验证并清理两个明确命名的隔离测试栈：

```bash
python3 scripts/backup_restore_test.py
```

生产 Secure Cookie 标志：

```bash
TEST_IMAGE=szyca:release-test python3 scripts/secure_cookie_test.py
```

## 数据库迁移

迁移文件位于 `backend/internal/platform/migrate/migrations/`。应用启动时：

1. 获取 PostgreSQL advisory lock；
2. 校验 `schema_migrations` 中已应用版本的 SHA-256；
3. 将每个待执行迁移和版本记录放在同一事务中提交；
4. 失败时回滚该版本并终止启动，不留下半迁移状态。

旧库升级会先执行幂等的 `0001_quiz_baseline.sql`，保留用户、题目、作答、轮次、二维码、背景、页脚和 Logo 数据。

## License

[MIT](LICENSE) © 2026 黎智锋（Li Zhifeng）
