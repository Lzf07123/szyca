# szyca API

> 版本：2.3
> 更新：2026-11-24
> 所有 API 使用同源 Cookie 或 Bearer token；未声明为后台的接口不要求管理员会话。

## 1. 通用约定

- JSON 请求使用 `Content-Type: application/json`。
- 用户 token 通过 `Authorization: Bearer <token>` 发送；兼容 `?token=`。
- 后台会话通过 HttpOnly Cookie 发送，写请求还必须带 `Origin` 和 `X-CSRF-Token`。
- 错误响应：

```json
{
  "error": "面向用户的错误说明",
  "code": "machine_readable_code"
}
```

- 关键请求可携带 `X-Request-ID`；后台写操作会在审计表中记录该值。
- 公开功能开关的关闭响应为 `404 feature_disabled`。

## 2. 管理员会话

### POST `/api/admin/auth/login`

```json
{
  "username": "owner",
  "password": "<password>"
}
```

成功返回管理员、角色、权限和 CSRF token，并设置 HttpOnly Cookie。

### GET `/api/admin/auth/status`

公开的状态查询，不把“尚未登录”建模为 404：

```json
{
  "account": null,
  "csrf_token": ""
}
```

已有有效会话时返回当前账号，并轮换 CSRF token。

### GET `/api/admin/auth/me`

严格要求有效后台会话。用于 API 调用和会话校验。

### POST `/api/admin/auth/logout`

要求 Cookie、Origin 和 CSRF；删除服务端会话并清理 Cookie。

## 3. 公开站点

### GET `/api/site`

一次请求返回公开页面所需全部数据：

```json
{
  "brand": {},
  "nav": [],
  "footer": {},
  "features": [],
  "sections": [],
  "backgrounds": [],
  "qrcodes": []
}
```

- `features` 只允许 `quiz / lottery / join / screen`。
- `sections.kind` 必须是后端已注册的 Section 插件 key；内置插件为 `hero / about / activities / quiz / screen / lottery / lottery-participate / join / gallery`。
- `sections.plugin_version` 表示插件契约版本；同一 `kind` 可以有多个独立实例，以 `id` 区分。
- `nav` 由当前公开的 `module-card` Section 生成：标题使用 `config.title`，目标使用 `config.action_to`，顺序跟随 Section 排序；相同目标只保留首个入口。
- `gallery` Section 额外返回 `gallery` 数组，条目包含 `id / section_id / title / image_url / sort / created_at / updated_at`。
- `qrcodes` 由 Join 模块的 `QrcodeProvider` 贡献；公开条目只包含 `id / title / image_url`。
- 关闭功能或停用 Section 时，对应页眉导航和 Section 同步移除；模块公开子模式关闭时，也只返回对应子模式可见的 Section 与导航。
- 响应带 ETag；`If-None-Match` 命中时返回 304。
- `Cache-Control: public, max-age=0, must-revalidate`，保证配置尽快生效。

### GET `/api/content/pages/{slug}`

返回已发布页面；不存在或尚未发布返回 404。

### GET `/api/config`

兼容旧客户端和现场页面的聚合配置。当前字段：

```json
{
  "title": "计算机协会 · 招新答题",
  "quiz_state": "stop",
  "question_seconds": 20,
  "announcement": "",
  "footer": {},
  "logo_url": "",
  "features": {
    "quiz": true,
    "lottery": false,
    "join": true,
    "screen": true
  }
}
```

- `quiz_state / question_seconds / title` 由 Quiz 的 `ConfigContributor` 贡献；
- `announcement` 由 Realtime 的 `ConfigContributor` 贡献；
- `footer / logo_url / features` 由 core site 提供。

## 4. 答题

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/session` | 创建/恢复参与者身份 |
| GET | `/api/identity/status` | 查询设备是否已有身份，始终返回 200 |
| GET | `/api/identity/current` | 旧版身份查询，未绑定返回 404 |
| POST | `/api/identity/abandon` | 放弃身份 |
| POST | `/api/quiz/round` | 开始一轮 |
| GET | `/api/quiz/current` | 恢复当前轮 |
| POST | `/api/quiz/round/abandon` | 放弃当前轮 |
| POST | `/api/answer` | 提交当前题 |
| GET | `/api/me` | 个人成绩与排名 |
| GET | `/api/stats` | 聚合统计：参与人数、累计答题、启用题目数、在线连接数 |
| GET | `/api/runtime` | 公开系统运行时长；返回 `uptime_seconds` 与 `started_at`，`Cache-Control: no-store` |
| GET | `/ws` | Realtime 模块提供的实时更新 WebSocket |

答题完整性约束：

- 正确答案不下发。
- 一轮题序落库。
- `request_id` 全局幂等。
- `(user_id, round_no, question_id)` 只允许一条计分记录。
- 服务端判定本题截止时间。

### 4.1 排行榜与大屏

| 方法 | 路径 | 所属模块 | 约束 |
|---|---|---|---|
| GET | `/api/rank?top=99` | `screen` | 受 `screen` feature 控制 |
| GET | `/ws` | `realtime` | `quiz`、`screen` 或 `lottery` 任一开启即可连接 |

`/api/rank` 只读取 Quiz 的排名服务，不写 Quiz 表。WebSocket 推送状态、排名、
公告、特效和 `lottery_board` 号码大屏状态事件。

## 5. 抽奖

### GET `/api/lottery/board`

公开返回当前正在展示的号码开奖场次；无需用户 token：

```json
{
  "enabled": true,
  "event": {
    "id": 1,
    "name": "2026 招新现场抽奖",
    "status": "live",
    "range_start": "1",
    "range_end": "999",
    "number_width": 3,
    "revision": 3,
    "completed": false
  },
  "levels": [
    {
      "id": 10,
      "name": "三等奖",
      "winner_count": 20,
      "sort": 10,
      "state": "pending",
      "winners": []
    }
  ]
}
```

- 号码范围和中奖号码以十进制字符串返回，避免浏览器大整数精度丢失。
- `winners` 按服务端开奖生成顺序返回，不按号码数值排序；该顺序由持久化
  `position` 决定，刷新页面或重连 WebSocket 后保持稳定。
- 无上线场次时 `event` 为 `null`；号码大屏模式关闭时 `enabled` 为 `false`。
- 公开响应不包含操作员、请求 ID、其他后台配置。

### GET `/api/lottery/campaign`

个人抽奖模式开启时，返回当前公开活动及用户状态：

```json
{
  "campaign": {
    "id": 1,
    "name": "招新抽奖",
    "status": "active",
    "state": "active",
    "eligibility": "completed_round",
    "eligibility_min_score": 0,
    "prizes": [
      { "name": "周边礼包", "remaining": 20 }
    ]
  },
  "eligible": true,
  "draw": null
}
```

公开响应不包含权重、未中奖权重、其他用户记录或后台配置。个人模式关闭时返回
`404 mode_disabled`。

### POST `/api/lottery/draw`

需要用户 token：

```json
{
  "request_id": "全球唯一 UUID"
}
```

成功结果：

```json
{
  "draw_id": 12,
  "campaign_id": 1,
  "result": "won",
  "prize": { "id": 3, "name": "周边礼包" },
  "claimed": false,
  "created_at": "2026-11-23T10:00:00+08:00"
}
```

错误码：

| HTTP | code | 语义 |
|---:|---|---|
| 404 | `feature_disabled` | 全局抽奖开关关闭 |
| 404 | `mode_disabled` | 个人抽奖子开关关闭 |
| 409 | `campaign_not_active` | 未开始、暂停或结束 |
| 403 | `not_eligible` | 未完成答题或未达标 |
| 409 | `already_drawn` | 本周活动已抽取过 |
| 409 | `request_conflict` | request_id 已被其他请求使用 |
| 400 | `invalid_request` | request_id 或身份参数无效 |

同一用户同一活动只允许一次。相同 `request_id` 重放返回原结果且不扣库存。

### GET `/api/lottery/me`

返回当前用户在本活动的抽奖、奖品和领取状态。

## 6. 后台接口

### 管理员与审计

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/admin/accounts` | `access.manage` |
| POST | `/api/admin/accounts` | `access.manage` |
| POST | `/api/admin/accounts/{id}/disabled` | `access.manage` |
| GET | `/api/admin/audit` | `audit.read` |

### 站点、媒体和平台

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/admin/site` | `site.read` |
| GET | `/api/admin/site/sections` | `site.read` |
| GET | `/api/admin/site/section-plugins` | `site.read` |
| PUT | `/api/admin/site/sections` | `site.write` |
| GET | `/api/admin/gallery/{sectionID}/images` | `site.read` |
| POST | `/api/admin/gallery/{sectionID}/images` | `site.write`，multipart：`file`、可选 `title` |
| POST | `/api/admin/gallery/{sectionID}/images/{imageID}` | `site.write`，修改图片说明 |
| DELETE | `/api/admin/gallery/{sectionID}/images/{imageID}` | `site.write` |
| PUT | `/api/admin/gallery/{sectionID}/images/order` | `site.write`，body：`{"ids":[...]}` |
| GET | `/api/admin/platform/features` | `site.read` |
| PUT | `/api/admin/platform/features` | 按模块 `feature_write_capability` 检查权限 |
| GET | `/api/admin/media` | `media.read` |
| DELETE | `/api/admin/media/{id}` | `media.write`，存在引用时返回 409 |

首页 Section 使用一次事务保存新增、修改和删除：

```json
{
  "sections": [
    {
      "id": 0,
      "kind": "gallery",
      "plugin_version": 1,
      "enabled": true,
      "sort": 80,
      "starts_at": null,
      "ends_at": null,
      "config": {},
      "status": "draft"
    }
  ],
  "deleted_ids": [7]
}
```

- `id: 0` 表示新增，正整数表示更新；保存成功后响应返回最新 `sections`（含真实 ID）。
- `kind` 是插件 key，`plugin_version` 省略时使用后端当前注册版本。
- `deleted_ids` 列出本次要删除的既有区块 ID，可省略。
- 同一 `kind` 可以有多个实例；是否允许重复及最大数量由插件 Manifest 的 `repeatable / max_instances` 决定，内置插件均允许重复且数量不限。
- 校验、删除、新增和更新处于同一数据库事务，任一失败均不落地。

`GET /api/admin/site/section-plugins` 返回 `{"plugins":[...]}`。Manifest 包含 `key / version / scope / label / description / feature / repeatable / max_instances / summary_field / default_config / fields`，后台根据 `fields` 生成通用配置表单。模块 `module.json` 另保存 `layout / home_order` 等编译期元数据。插件开发契约见 [Section插件开发.md](Section插件开发.md)。

`GET /api/admin/overview` 由 core 合并各模块 `OverviewContributor`，当前 Quiz 贡献用户、答题、参与者和题目数据，core 贡献在线连接、背景数量、运行时间、Goroutine 和内存。

活动影像使用 Gallery 模块独立拥有的 `gallery_images` 数据，不把图片数组写进 Section `config`。每个 gallery Section 最多 4 张图片；上传文件只支持 JPG/PNG/WebP/GIF，单张不超过 10MB。本地文件自动登记 `media` 引用；删除图片或删除整个 gallery Section 时，只有在没有其他资源引用后才清理磁盘文件。

### 抽奖运营

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/admin/lottery/modes` | `lottery.configure` |
| PUT | `/api/admin/lottery/modes` | `lottery.configure` |
| GET | `/api/admin/lottery/number-events` | `lottery.configure` |
| POST | `/api/admin/lottery/number-events` | `lottery.configure` |
| GET | `/api/admin/lottery/number-events/{id}` | `lottery.configure` |
| DELETE | `/api/admin/lottery/number-events/{id}` | `lottery.configure` |
| POST | `/api/admin/lottery/number-events/{id}/publish` | `lottery.configure` |
| POST | `/api/admin/lottery/number-events/{id}/archive` | `lottery.configure` |
| POST | `/api/admin/lottery/number-events/{id}/draw` | `lottery.configure` |
| GET | `/api/admin/lottery/number-events/{id}/export` | `lottery.configure` |
| GET | `/api/admin/lottery/campaigns` | `lottery.configure` |
| POST | `/api/admin/lottery/campaigns` | `lottery.configure` |
| POST | `/api/admin/lottery/campaigns/{id}/status` | `lottery.configure` |
| POST | `/api/admin/lottery/campaigns/{id}/prizes` | `lottery.configure` |
| DELETE | `/api/admin/lottery/campaigns/{id}/prizes/{prizeId}` | `lottery.configure` |
| GET | `/api/admin/lottery/draws` | `lottery.configure` |
| GET | `/api/admin/lottery/export` | `lottery.configure` |
| POST | `/api/admin/lottery/draws/{id}/claim` | `lottery.claim` |

号码场次状态为 `draft / live / archived`，同一时间最多一个 `live` 场次。
`draw` 请求体为 `{level_id, request_id}`，`levels` 数组顺序即开奖顺序，必须按小奖到大奖
排列，只能触发数组中的下一个待开等级；
相同请求重放返回原结果且不会重复扣减号码。
升级后的模式默认值为号码大屏开启、个人抽取关闭，模块总开关仍单独控制整个抽奖模块。

### 固定角色

| 角色 | 主要能力 |
|---|---|
| `owner` | 全部权限、管理员与审计 |
| `content_editor` | 站点和媒体，不能操作答题或抽奖 |
| `event_operator` | 答题控制、抽奖配置与领取 |
| `data_viewer` | 题目/成绩只读、审计只读 |

## 7. 模块归属索引

| API 前缀/路径 | 所属模块 |
|---|---|
| `/api/session`、`/api/identity/*`、`/api/quiz/*`、`/api/answer`、`/api/me`、`/api/stats` | `quiz` |
| `/api/rank` | `screen` |
| `/api/lottery/*` | `lottery` |
| `/api/qrcode`、`/api/admin/qrcodes*` | `join` |
| `/ws`、`/api/admin/announce`、`/api/admin/effect` | `realtime` |
| `/api/admin/gallery/*` | `gallery` |
| `/api/site`、`/api/config`、Section、功能开关、背景、页脚和 Logo | core + contributors |

模块定义、后端接口、前端 runtime、迁移和测试要求见
[模块开发契约.md](模块开发契约.md)。

## 8. 兼容期

- `/api/config`、`/api/backgrounds`、`/api/qrcode` 保留给旧客户端。
- 旧 `X-Admin-Token` 默认关闭；仅设置 `LEGACY_ADMIN_TOKEN_ENABLED=true` 时在迁移窗口启用。
