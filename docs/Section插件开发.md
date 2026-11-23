# Section 插件开发契约

> 契约版本：2
>
> 适用范围：首页 `home_sections`
>
> 运行模式：编译期 Go + React Section 插件

## 1. 定位

Section 插件描述首页中的一个展示区块：

- 渲染布局；
- 默认文案和配置字段；
- 是否绑定功能开关；
- 可重复实例数量；
- 前端 Renderer/Editor；
- 可选的模块所有权。

Section 不拥有 Quiz 回合、Lottery 库存、用户身份等业务数据。业务逻辑留在功能模块，
模块目录、Manifest 和运行时契约见 [模块开发契约.md](模块开发契约.md)。

## 2. 编译期边界

Section 在构建时进入 Go 二进制和 React 产物。系统不支持：

- 运行期 Go `.so`；
- 远程 JavaScript；
- WASM；
- 任意 HTML；
- 动态执行数据库脚本。

这样可以保持单镜像、单容器、单数据卷，并使前后端版本显式匹配。

## 3. 数据身份

`home_sections`：

| 字段 | 含义 |
|---|---|
| `id` | Section 实例唯一身份 |
| `kind` | Section 插件 key |
| `plugin_version` | 插件契约版本 |
| `enabled` | 业务启停 |
| `sort` | 实例排序 |
| `starts_at/ends_at` | 可选生效窗口 |
| `config` | JSON 配置纯文本 |
| `status` | `draft/published/archived` |

React key、排序、启停、发布、删除和审计都以 `id` 为准。`kind` 可以重复。

## 4. 后端 Manifest

业务 Section 直接声明在 `modules/<key>/module.json.sections`。生成器将其汇入：

```go
type Section struct {
    Key           string
    Version       int
    Scope         string
    Layout        string
    HomeOrder     int
    Label         string
    Description   string
    Feature       string
    Repeatable    bool
    MaxInstances  int
    SummaryField  string
    DefaultConfig json.RawMessage
    Fields        []SectionField
}
```

字段约束：

- `key`：小写字母开头，只允许字母、数字、`_`、`-`。
- `version > 0`。
- `scope` 当前只允许 `home`。
- `layout` 只允许 `block` 或 `module-card`。
- `feature` 为空或已注册模块 feature。
- `max_instances=0` 表示不限。
- `default_config` 必须符合字段 Schema。
- `key@version` 全局唯一。

`home_order` 只提供默认展示顺序建议；数据库实例的 `sort` 是运行时权威。

## 5. 配置字段 Schema

| 类型 | 值 | 服务端校验 |
|---|---|---|
| `text` | 字符串 | 长度上限、禁止 HTML |
| `textarea` | 字符串 | 长度上限、禁止 HTML |
| `path` | 站内路径 | 以 `/` 开头、禁止协议和 HTML |
| `items` | 对象数组 | 数量上限、逐项白名单、不允许嵌套 `items` |

保存步骤：

1. 合并 `default_config`；
2. 拒绝未知字段；
3. 逐字段校验类型、长度和 HTML；
4. 写入规范化 JSON。

## 6. 注册链路

```text
modules/<key>/module.json.sections
  -> cmd/modulegen
  -> backend/core/modulecatalog/sections
  -> site section registry
  -> /api/admin/site/section-plugins

modules/<key>/frontend/sections
  -> moduleRuntime.sections
  -> frontend site-section registry
  -> Home renderer / SiteEditor
```

业务 Section 不得再在 `backend/core/site/plugins.go` 或
`frontend/src/site-sections/` 手工注册。

Core Section（Hero/About/Activities）仍位于 core；其前端实现位于
`frontend/src/site-sections/<key>/`。

## 7. 前端插件

```ts
interface SectionFrontendPlugin {
  key: string
  version: number
  layout: 'block' | 'module-card'
  Renderer: ComponentType<SectionRendererProps>
  Editor?: ComponentType<SectionEditorProps>
}
```

`Renderer` 必须只依赖：

- 当前 `section`；
- `SectionRenderContext`；
- core 共享 UI 和公开 API。

禁止按 `kind` 用 `find()` 获取唯一实例，也禁止从其他模块读取内部 state。

### 7.1 block

首页按 `sort,id` 逐实例独立渲染。适用于 Hero、About、Activities、Gallery。

### 7.2 module-card

所有 `module-card` 实例进入统一模块网格：

- Quiz；
- Screen；
- Lottery；
- Join。

Home 不按模块 key 插入特殊卡片。网格数量和顺序来自当前公开 Section 数据。

### 7.3 自定义 Editor

普通字段由后端 `fields` 自动生成表单。需要独立数据 CRUD 时可提供 `Editor`，
例如 Gallery 的图片上传、重排和说明编辑。

Editor 必须：

- 遵守本 Section 实例 ID；
- 通过公开模块 API 操作数据；
- 保留 `canWrite` 权限判断；
- 不直接修改共享 DOM 或全局 store。

## 8. 版本兼容

- 保存时省略 `plugin_version` 使用当前注册版本。
- 只接受当前注册版本。
- 后端版本不匹配时公开端跳过，后台显示“插件不可用”。
- 前端缺少同 key@version 渲染器时同样跳过公开渲染。
- 插件缺失或升级不自动删除数据库实例。
- 修改 Schema 时必须提升版本并新增迁移，不能静默解释旧结构。

## 9. Gallery 示例

Gallery v2 是带独立数据的 Section：

- Section `config` 只存眉题、标题和正文；
- `gallery_images` 归 Gallery 模块；
- 文件资产和引用归 Media 模块；
- 每实例最多 4 张；
- 支持 JPG/PNG/WebP/GIF，单张不超过 10MB；
- 后端通过 `site.GalleryProvider` 向 `/api/site` 附加图片；
- 前端 Renderer/Editor 位于 `modules/gallery/frontend/sections/`。

## 10. 安全

- 配置只存纯文本 JSON。
- 禁止 HTML 和 `javascript:`。
- 路径字段只能指向站内。
- 文件生命周期由 Media references 决定。
- Section 写接口必须使用 `site.write`并经过 CSRF、Origin 和审计。
- 运行期第三方插件不能直接复用当前契约进入 Go 进程。

## 11. 新增 Section 步骤

1. 在模块 `module.json.sections` 添加 Manifest。
2. 在 `modules/<key>/frontend/sections/` 实现 Renderer；必要时实现 Editor。
3. 在模块 `frontend/index.tsx` 的 `moduleRuntime.sections` 中导出。
4. 如需独立数据表，在模块 `backend/migrations/` 新增时间戳迁移。
5. 更新模块 API 和权限。
6. 运行 `modulegen --write` 和 `--check`。
7. 测试默认配置、多实例、未知字段、HTML/path 拒绝、版本不兼容、响应式和 axe。

## 12. 下线 Section

- 先停用 Section，再删除实例或移除插件。
- 不删除历史迁移和已有数据。
- 未知插件实例公开端隐藏，后台保留删除能力。
- 删除整个功能模块时，其 Section Manifest 和前端实现随模块目录移除；数据库记录保留。
