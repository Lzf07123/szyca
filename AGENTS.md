# AGENTS.md — szyca Agent 开发指引

本文件面向在本仓库工作的编码 agent，从仓库根目录递归生效。若未来出现更近层级的
`AGENTS.md`，以目录层级最近者为准；用户在当前任务中的明确指令优先于本文件。目标是让
agent 在不破坏数据、模块边界和交付闭环的前提下自行推进，而不是等待用户逐步指挥。

## 1. 工作方式

- 默认由 agent 主导完成“探索现状 → 确定最小改动 → 实现 → 分级验证 → 三段式汇报”。
  不要等待用户先给出可由代码和项目配置查明的事实。
- 修改前先读相关实现、契约和测试；优先修复根因，不做顺手重构、示例代码、占位模块、
  预测性抽象或无关工程化。
- 先运行 `git status --short --branch`，保留用户已有改动，不覆盖、不回滚、不提交无关内容。
  除非用户明确要求，否则不要提交 commit。
- 需求含糊但存在安全、兼容或数据语义风险时先问清；能在现有契约内合理判断时直接推进。
- 遇到 Dockerfile、Compose、`.devcontainer`、新依赖、服务重建/重启/拉取、既有数据迁移或
  破坏性操作时，先说明影响并取得用户确认。
- 只读取完成任务所需的资料。模块改动先读 `docs/模块开发契约.md` 和
  `docs/架构与模块.md`；Section 改动读 `docs/Section插件开发.md`；API 改动读
  `docs/API.md`；部署相关改动读 `docs/部署与回滚.md`。

## 2. 环境与容器边界

每个任务开始时确认以下事实，不要沿用上一次会话的假设：

```bash
whoami
git status --short --branch
docker compose -f deploy/docker-compose.yml ps
docker inspect szyca --format '{{range .Mounts}}{{println .Type .Name .Source .Destination}}{{end}}'
```

- 当前源码在宿主机工作区，运行时 `szyca` 容器只挂载持久卷 `szyca_data:/data`；
  `/app/server` 与 `/app/web` 是镜像构建产物，不是源码，也没有源码 bind mount。
- 运行中的 `szyca` 容器用于实际服务和运行态排查，不包含 Go/Node 工具链。不要通过
  `docker compose exec` 修改 `/app`，也不要假设宿主机源码变更会热更新到该容器。
- 宿主机用户与容器用户可能不同，且 `docker compose exec` 默认可能以 root 执行。每次实查，
  不要把用户身份、容器状态或权限硬编码为长期事实；不要借 root 身份修改 `/data`、业务表
  或文件所有者。
- 所有编译、生成、测试命令必须在挂载源码的容器内执行。项目现有方式是一次性
  `docker run -v "$PWD:/src" ...`，或在用户批准后使用隔离 Compose 测试栈。
- 不得依赖容器内手工 `apt/apk`、`pip/npm install` 或临时环境变量作为实现方案；
  这些状态会随容器销毁。依赖只能按项目现有包管理器安装到工作区并同步锁文件。
- 禁止原地修改当前 `szyca` 服务来“快速验证”。把它视为有状态、可能承载真实数据的服务；
  未获批准不得停止、重建、重启、重拉或清理其容器/镜像/卷。
- `docker compose exec` 仅用于运行态只读检查，例如进程、日志、数据库查询。示例：

```bash
docker compose -f deploy/docker-compose.yml exec -T szyca sh
docker compose -f deploy/docker-compose.yml logs --tail=100 szyca
```

## 3. 项目地图

项目是汕头职业技术学院计算机协会官网与招新答题系统，采用 Go 1.27、PostgreSQL、
Redis、React 18、Vite、Nginx。生产形态固定为单镜像、单容器、单数据卷；Nginx 对外
8080，Go 监听容器内 8081，PostgreSQL 与 Redis 只监听容器回环地址。

| 路径 | 职责 |
|---|---|
| `backend/contract/` | 跨层契约：Module、HTTP、用户、贡献接口 |
| `backend/core/` | 共享内核：HTTP、权限、审计、媒体、站点、迁移、注册表 |
| `modules/<key>/` | 六个业务模块：`quiz`、`lottery`、`join`、`screen`、`realtime`、`gallery` |
| `frontend/src/` | React 站壳、共享组件、Section runtime、API 客户端 |
| `cmd/modulegen/` | 从 Manifest 与迁移生成 Go/TS 注册代码 |
| `deploy/` | Dockerfile、Compose、Nginx、Supervisor；默认禁改 |
| `docs/` | 架构、API、模块契约、部署和验收说明 |
| `design-system/szyca/` | 项目自有深空品牌、模板和生成快照 |
| `tests/browser/` | Playwright + axe 浏览器验收 |
| `scripts/` | 集成、迁移、备份恢复和模板检查脚本 |

模块行为的权威来源依次是当前代码中的 `backend/contract/`、`modules/*/module.json`、
`cmd/modulegen/main.go` 和直接测试；说明文档与代码冲突时以代码为准。任务改变公共契约时，
同步更新相应文档和示例。

## 4. 架构硬约束

### 4.1 模块所有权

- `backend/core` 不得 import `modules/*`。
- 模块不得 import 另一模块的实现；跨模块协作只能使用消费方声明的窄接口、
  `backend/contract` 或 core provider。
- 模块业务表由模块自己写；其他模块不得直接读写这些表。
- `Home.tsx`、`App.tsx`、`Admin.tsx` 不得硬编码具体模块 key 分支。
- 模块由生成器在编译期并入同一 Go 二进制与 React 产物。不支持运行期插件、
  `Go .so`、WASM、远程 JavaScript 或数据库脚本热执行。

当前模块依赖关系：

| 模块 | 依赖 | 所有权摘要 |
|---|---|---|
| `quiz` | 无 | 身份、题库、轮次、作答、成绩、排行数据 |
| `lottery` | `quiz` | 活动、奖品、抽取、库存、领取 |
| `join` | 无 | 加入页面、二维码 |
| `screen` | `quiz`、`realtime` | 大屏与排名 API |
| `realtime` | `quiz` | WebSocket、公告、特效 |
| `gallery` | 无 | 图集、图片排序、Section 编辑器 |

### 4.2 Manifest 是模块事实源

`modules/<key>/module.json` 是模块元数据的唯一事实源，当前 `schema` 固定为 `1`。
公开页面和主要 API surface 必须与以下内容同步，不能只手改其中一处：

- `module.json.routes`；
- 后端 `backend/routes.go` 中实际的 `RegisterHTTP` 路径，它也是精确路由的权威；
- 前端 `frontend/index.tsx` 中实际的懒加载 route/页面；
- 对应测试与公开 API 文档。

新增或修改 capability 时，后台接口必须在服务端通过 `api.Permission` 校验；修改功能
开关必须通过 `api.Feature`/`api.AnyFeature`。前端隐藏按钮不能代替授权。

### 4.3 后端生命周期

- 模块实现 `NewModule(contract.Dependencies) (contract.Module, error)`。
- 模块依赖通过 `requires` 决定构造顺序。
- `Start` 只能假设依赖的 service 已构造，不能假设依赖模块的 `Start` 已执行。
- `Stop` 必须可重复且安全，不得删除业务数据。
- `Ready` 只检查本模块运行依赖；`/readyz` 由 `contract.Readiness` 聚合。
- 跨模块暴露类型必须是窄接口，禁止把另一个模块的 service 强转后调用未声明方法。

### 4.4 前端契约

- 模块必须导出 `defineAppModule` 与 `moduleRuntime`，页面使用 `lazy()`。
- `moduleRuntime.adminPanels` 的 key、tab、permission、order 必须与 `module.json`
  的 `admin_panels` 一致。
- 模块只通过 `@core` 和自身相对路径取共享能力，不得直接 import 其他模块组件。
- 共享样式使用 `@core`；模块样式放在 `modules/<key>/frontend/styles.css`。
- 首页每个 Section 实例以 `id` 为身份；`kind` 可以重复。禁止用 `find()` 取
  “唯一实例”或跨实例共享内部状态。

### 4.5 Section 插件

- 业务 Section 在模块 `module.json.sections` 声明，前端实现在
  `modules/<key>/frontend/sections/`，不得在 core registry 手工注册。
- `scope` 当前只允许 `home`；`layout` 只允许 `block` 或 `module-card`。
- 配置字段只允许 `text`、`textarea`、`path`、`items`，禁止 HTML、协议路径和嵌套
  `items`；保存时不得接受未知字段。
- 修改 Section 配置 Schema 必须提升 `version` 并新增迁移，不能静默解释旧结构。
- 未知插件或版本不匹配时公开端跳过，后台保留查看和删除能力，不自动清理数据。

## 5. 生成文件与迁移

以下文件由 `cmd/modulegen` 生成并提交，禁止手工编辑：

- `backend/core/modulecatalog/catalog.generated.go`
- `backend/core/modulecatalog/manifests.generated.json`
- `backend/core/modulecatalog/migrations.generated.json`
- `backend/core/moduleregistry/registry.generated.go`
- `frontend/src/generated/catalog.generated.ts`
- `frontend/src/generated/module-catalog.generated.json`
- `frontend/src/modules/registry.generated.ts`
- `frontend/src/module-styles.generated.ts`

修改 `module.json`、增加/删除模块迁移、增加/删除模块，或增加/删除模块样式文件后，
按“先写后校验”更新注册产物：

```bash
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go run ./cmd/modulegen --write
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go run ./cmd/modulegen --check
```

迁移规则：

- core 历史兼容迁移位于 `backend/core/platform/migrate/migrations/`。
- 新模块迁移位于 `modules/<key>/backend/migrations/`，使用时间戳版本名。
- 已应用迁移禁止改名、改内容或删除 checksum 记录。
- 迁移按版本名排序，每个版本与其 `schema_migrations` 记录在同一事务提交。
- 模块下线不自动删表、删迁移或删历史数据；公开端只做过滤。

## 6. 安全与关键业务不变量

- 后台会话使用 HttpOnly + SameSite Cookie；写请求必须经过 Origin、CSRF 与 capability
  校验。统一使用现有 `api.Permission`，不要复制认证或审计中间件。
- 所有后台写操作必须进入统一审计；敏感字段、token、密码、正确答案、用户身份信息
  不得写入日志或公开响应。
- Quiz 在答题前和当前题响应中不得下发正确选项，提交后的反馈按 API 契约返回；
  题序、截止时间和计分以服务端持久化状态为准；同一轮同一题只计分一次，
  网络重试使用 `request_id` 幂等。
- 身份遵循“一人一设备一身份”，换昵称前需放弃旧身份；放弃后昵称封存与榜单留痕
  不可静默破坏。
- Lottery 使用 CSPRNG 加权抽取；库存扣减、抽取记录与幂等约束必须在事务内完成；
  时间窗口、暂停状态、资格与库存均以服务端为准。
- 上传和媒体删除必须使用 Media 台账与引用检查；被引用文件不得直接删除。
- 数据库访问使用现有 store/pgx 方式与参数化查询，不拼接用户输入。
- 不读取、输出或提交真实 `.env`、密钥、题库文件和用户数据；环境变量模板只看
  `.env.example`。

## 7. 视觉与代码风格

- Go 遵循现有 `net/http`、`httpx`、service/repository 分层；JSON 和错误响应优先
  复用现有 helper，不引入第二套 Web 框架或响应格式；提交前对改动过的 Go 文件执行
  `gofmt`，不要新增未获批准的 formatter 配置。
- TypeScript 保持 `strict`，使用现有函数组件、hooks、别名和 `fetch` 客户端；
  跟随相邻文件的引号、缩进和尾逗号风格；未经批准不新增 UI、状态管理或请求依赖。
- 颜色、字体、间距、圆角、动效优先使用 `frontend/src/index.css` 的令牌；
  共享视觉组件参考 `frontend/src/cosmos.css`，不要在模块中再造主题体系。
- 修改 `frontend/src/index.css` 或 `frontend/src/cosmos.css` 后必须重新导出并检查
  项目模板快照：

```bash
docker run --rm -v "$PWD:/src" -w /src python:3.12-alpine \
  python3 scripts/export_design_template.py --write
docker run --rm -v "$PWD:/src" -w /src python:3.12-alpine \
  python3 scripts/export_design_template.py --check
```

- 保持现有深空视觉签名和 820px 移动断点；涉及 UI 时检查键盘操作、焦点、触控目标、
  横向溢出和 `prefers-reduced-motion`。除非任务明确要求，不改品牌方向。
- 不提交 `node_modules/`、`dist/`、`artifacts/`、上传文件、运行日志或临时脚本。

## 8. 常用开发流程

### 修改现有模块

1. 阅读该模块 `module.json`、后端 module/routes/service/repository、前端入口和
   `tests/browser.mjs`。
2. 只改该模块拥有的实现；共享契约变化才进入 `backend/contract` 或 `frontend/src`。
3. 若增加路由、权限、后台面板或 Section，同步 Manifest、实际注册点和测试。
4. 若改动 Manifest、迁移或模块入口，执行 `modulegen --write`。
5. 按改动范围运行定向测试；收尾再按第 9 节执行完整验证。

### 新增模块

按 `docs/模块开发契约.md` 执行，不先手改生成注册表。最小顺序是：

1. `modules/<key>/module.json`；
2. 后端 `NewModule`、service/repository、routes、migration；
3. 前端 `moduleRuntime`、lazy pages、admin panels、sections、styles；
4. Go 测试与 `modules/<key>/tests/browser.mjs`；
5. `modulegen --write` 与 `modulegen --check`；
6. 定向 Go、前端构建和必要的浏览器验收。

不要为“未来插件”增加动态加载层，也不要创建无调用方的空模块。

### 新增或修改 API

1. 明确归属模块及是否需要 feature/permission gate。
2. 在 `routes.go` 注册真实路径，在 `module.json.routes` 声明公开 surface。
3. handler 只做协议转换，业务规则放 service，持久化规则放 repository。
4. 公共响应不得泄漏正确答案、内部权重、token 或其他用户私有数据。
5. 涉及权限、幂等、并发、库存或时限时，优先使用该模块已有的测试入口覆盖规则；
   没有对应测试时跳过临时验证并在汇报中说明，不编造一次性测试文件。

## 9. 验证纪律

验证以发现问题为目的，不表演尽责。修改后只选与改动最直接相关的一种检查；完整验证只在
任务收尾执行一次，失败修复后只重跑失败项。

| 改动 | 最小验证 |
|---|---|
| 纯文档/注释 | 目视核对路径、命令和交叉引用，不跑工具链 |
| 单个 Go 包 | 只跑直接覆盖该包的测试；无对应测试则明确说明，不临时造测试 |
| `module.json`/迁移/生成输入 | `modulegen --write` 后 `modulegen --check`，再跑相关测试 |
| 前端逻辑/类型 | 在 Node 20 容器内执行 `npm run build` |
| CSS 令牌/共享视觉 | 前端构建 + `export_design_template.py --check` |
| API 权限、迁移、并发、库存、时限 | 定向 Go 测试；必要时运行隔离集成测试 |
| 明显用户流程或响应式改动 | 隔离栈上的 Playwright 验收 |

项目没有 ESLint、Prettier、golangci-lint 或 CI 配置，不要虚构这些命令。
同一命令连续失败两次后必须停止，汇报已排除项和失败原因，不得盲目重跑。修复后只重跑
失败的检查；代码路径未变化时，不重复执行已通过的命令。

常用容器命令：

```bash
# 单包（把路径替换为实际 Go 包）
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go test ./modules/quiz/backend

# 仅首次或 lock 变化时安装前端依赖；node_modules 在工作区且已忽略
docker run --rm -v "$PWD:/src" -w /src/frontend node:24-alpine \
  npm ci --no-audit --no-fund

# 前端类型检查 + Vite 构建
docker run --rm -v "$PWD:/src" -w /src/frontend node:24-alpine \
  npm run build
```

完整验证仅在宣布完成前执行一次；只重跑失败项，不重复已通过且代码未变化的命令：

```bash
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine go test ./...
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine go vet ./...
docker run --rm -v "$PWD:/src" -w /src golang:1.27-alpine \
  go run ./cmd/modulegen --check
docker run --rm -v "$PWD:/src" -w /src/frontend node:24-alpine npm run build
```

集成与浏览器测试约束：

- 不得向当前 8080 运行实例和 `szyca_data` 卷发送写测试。
- 需要启动隔离栈、构建测试镜像或重启服务时，先取得用户确认。
- Python 集成脚本默认访问宿主机 `localhost:8091`，且共享状态；只能按 README 顺序执行，
  不能并发，顺序为 `integration_test.py`、`admin_access_test.py`、`site_media_test.py`、
  `lottery_test.py`、`migration_test.py`、`site_perf_test.py`。当前仓库没有可直接运行的
  容器化 Python 集成测试服务；若必须严格通过 Compose 容器执行而现有栈无法满足，停下来
  请用户决定，不要静默改走宿主机工具链，也不要擅自修改 Compose。
- Playwright 固定版本为 1.56.0；使用隔离栈与 `tests/browser` 现有脚本，模块场景必须由
  生成 Manifest 动态推导，不写死模块数量。
- `scripts/backup_restore_test.py` 要求容器名 `szyca` 空闲；当前服务占用该名称时禁止执行。
- 不为验证启动开发服务器、执行临时 `curl` 探活或生成一次性报告文件；使用已有测试入口。

## 10. 完成判据与汇报

宣布完成前确认：

- 只实现了当前任务要求的内容，没有死代码、示例、临时测试或无关格式化；
- Manifest、实际路由、前端入口、测试和生成文件一致；
- 相关检查通过，失败未被吞掉或通过放宽断言绕过；
- 工作区没有意外生成物、密钥、真实数据或无关文件。

最终汇报固定为三段：

1. **已完成**：改动清单及对应验证结果。
2. **已省略**：舍弃的步骤及一句话原因。
3. **待确认**：需要用户决策的事项；没有则写“无”。

验证结果使用一行式格式：`[命令] → 通过/失败（耗时）`；失败附一行原因。不要粘贴完整
日志，也不要写冗长的验证过程。
