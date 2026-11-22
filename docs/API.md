# szyca API

> 版本：2.0  
> 更新：2026-11-23  
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
- `sections.kind` 只允许 `hero / about / activities / quiz / lottery / join / gallery`。
- 关闭功能时导航和对应 Section 同步移除。
- 响应带 ETag；`If-None-Match` 命中时返回 304。
- `Cache-Control: public, max-age=0, must-revalidate`，保证配置尽快生效。

### GET `/api/content/pages/{slug}`

返回已发布页面；不存在或尚未发布返回 404。

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
| GET | `/api/rank?top=99` | 排行榜 |
| GET | `/api/stats` | 聚合统计 |
| GET | `/ws` | 实时更新 WebSocket |

答题完整性约束：

- 正确答案不下发。
- 一轮题序落库。
- `request_id` 全局幂等。
- `(user_id, round_no, question_id)` 只允许一条计分记录。
- 服务端判定本题截止时间。

## 5. 抽奖

### GET `/api/lottery/campaign`

返回当前公开活动及用户状态：

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

公开响应不包含权重、未中奖权重、其他用户记录或后台配置。

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
| PUT | `/api/admin/site/sections` | `site.write` |
| GET | `/api/admin/platform/features` | `site.read` |
| PUT | `/api/admin/platform/features` | 按模块检查 `site.write` / `lottery.configure` |
| GET | `/api/admin/media` | `media.read` |
| DELETE | `/api/admin/media/{id}` | `media.write`，存在引用时返回 409 |

### 抽奖运营

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/admin/lottery/campaigns` | `lottery.configure` |
| POST | `/api/admin/lottery/campaigns` | `lottery.configure` |
| POST | `/api/admin/lottery/campaigns/{id}/status` | `lottery.configure` |
| POST | `/api/admin/lottery/campaigns/{id}/prizes` | `lottery.configure` |
| DELETE | `/api/admin/lottery/campaigns/{id}/prizes/{prizeId}` | `lottery.configure` |
| GET | `/api/admin/lottery/draws` | `lottery.configure` |
| GET | `/api/admin/lottery/export` | `lottery.configure` |
| POST | `/api/admin/lottery/draws/{id}/claim` | `lottery.claim` |

### 固定角色

| 角色 | 主要能力 |
|---|---|
| `owner` | 全部权限、管理员与审计 |
| `content_editor` | 站点和媒体，不能操作答题或抽奖 |
| `event_operator` | 答题控制、抽奖配置与领取 |
| `data_viewer` | 题目/成绩只读、审计只读 |

## 7. 兼容期

- `/api/config`、`/api/backgrounds`、`/api/qrcode` 保留给旧客户端。
- 旧 `X-Admin-Token` 默认关闭；仅设置 `LEGACY_ADMIN_TOKEN_ENABLED=true` 时在迁移窗口启用。
