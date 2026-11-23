# Section 插件开发契约

> 版本：1
> 适用范围：首页 `home_sections`
> 参考：Halo 的 Manifest + 扩展点设计，不引入运行期 Go 插件或远程代码加载。

## 1. 设计边界

Section 插件采用**编译期注册**：插件在构建时进入 Go 二进制和 React 产物，随现有单容器镜像发布。

Section 插件不是业务功能模块。它只拥有首页区块的展示、编辑字段、默认值和排序语义；答题、抽奖、排行榜、加入等完整能力由 [功能模块开发.md](功能模块开发.md) 定义的模块接入。Section 插件可以绑定模块 feature，但不持有模块业务数据。

不在本轮引入 `.so`、WASM、远程 JS、动态数据库脚本或任意 HTML。这样可以保持：

- 单镜像、单容器、单数据卷的部署方式；
- 配置校验和 XSS 防护在服务端完成；
- 插件版本与前端渲染器明确匹配；
- 回滚只依赖镜像版本和数据库迁移，不依赖容器层临时状态。

## 2. 数据身份

`home_sections` 中：

- `kind`：插件 key，不是唯一实例标识；
- `plugin_version`：插件契约版本；
- `id`：Section 实例 ID。

React key、排序、启停、发布、删除和审计均以 `id` 为准。同一 `kind` 默认可以重复创建多个实例，是否允许重复由 Manifest 的 `repeatable` 和 `max_instances` 决定。

## 3. 后端 Manifest

后端 Manifest 是插件类型、默认配置、配置字段 Schema 和权限绑定的权威来源：

```go
type SectionPluginManifest struct {
	Key           string
	Version       int
	Scope         string
	Label         string
	Description   string
	Feature       string
	Repeatable    bool
	MaxInstances  int
	SummaryField  string
	DefaultConfig json.RawMessage
	Fields        []SectionConfigField
}
```

约束：

- `key` 使用小写字母开头，只允许字母、数字、`_`、`-`；
- `version` 从 1 开始，保存时默认采用当前注册版本；
- `scope` 当前仅允许 `home`；
- `feature` 为空表示不绑定功能开关，否则必须是 `quiz / lottery / join / screen`；
- `max_instances = 0` 表示不限制，非零值必须配合重复校验；
- `list` 接口按注册顺序返回 Manifest。

### 3.1 配置字段 Schema

| 类型 | 值 | 服务端校验 |
|---|---|---|
| `text` | 字符串 | 长度上限、禁止 HTML |
| `textarea` | 字符串 | 长度上限、禁止 HTML |
| `path` | 站内路径 | 以 `/` 开头、禁止协议和 HTML |
| `items` | 对象数组 | 条目上限、嵌套字段白名单和逐项校验 |

`items.item_fields` 中不允许再次嵌套 `items`。保存配置时先合并 `default_config`，再校验字段白名单；未知字段直接拒绝。

## 4. 前端扩展点

前端只负责可执行界面，元数据仍从后端 Manifest 获取：

```ts
interface SectionFrontendPlugin {
  key: string
  version: number
  layout: 'block' | 'module-card'
  Renderer: ComponentType<SectionRendererProps>
  Editor?: ComponentType<SectionEditorProps>
}
```

- `layout = block`：首页逐实例独立渲染。
- `layout = module-card`：同类或不同类卡片由一个模块布局组聚合；当前 `quiz / lottery / join` 使用此模式，排行榜启用时由模块配置追加。
- 后台始终按 Manifest 的 `fields` 生成基础表单；复杂插件可提供自定义 `Editor`，在基础字段之后追加专用管理界面。
- `Renderer` 必须只依赖传入的 `section` 和渲染上下文，不得再次按 `kind` 使用 `find` 取唯一实例。

已注册实现位于：

- `frontend/src/site-sections/contract.ts`
- `frontend/src/site-sections/registry.tsx`
- `frontend/src/site-sections/plugins.tsx`

## 5. 接入新插件

1. 在 `backend/internal/site/plugins.go` 增加 Manifest，声明 key、版本、默认配置、字段和权限。
2. 在 `builtinSectionPlugins()` 注册 Manifest，或通过 `NewWithSectionPlugins` 注入测试/定制注册表。
3. 在前端新增 `Renderer`，需要特殊交互时再增加 `Editor`。
4. 在 `frontend/src/site-sections/registry.tsx` 用相同 `key + version` 注册。
5. 为数据库新增历史和插件升级编写新迁移，不修改已应用迁移。
6. 覆盖：同类多实例、默认配置合并、未知字段拒绝、路径安全、版本不兼容和首页逐实例渲染。

新增普通字段、复用通用表单和独立渲染时，不需要修改 `Home.tsx` 或 `SiteEditor.tsx` 的字段分支。

### 5.1 活动影像插件

`gallery` v2 是带独立数据的 Section：

- Section `config` 只保存眉题、标题和正文；
- 图片条目归 `site` 模块的 `gallery_images` 表所有；
- 文件归 `media` 模块所有，引用格式为 `module=gallery / resource_type=image / resource_id=imageID`；
- 每个实例最多 4 张图片，后台通过 `/api/admin/gallery/{sectionID}/images` CRUD 接口管理上传、说明、重排和删除；
- `/api/site` 在对应 Section 上返回 `gallery` 数组，公开端不需要额外请求。

## 6. 版本与兼容

- 只接受当前注册版本；请求省略 `plugin_version` 时使用当前版本。
- 前端未注册相同 `key@version` 时，后台显示“插件不可用”，公开端跳过渲染。
- 插件缺失或版本不兼容时不自动删除数据；后台仍允许删除该实例。
- 升级插件配置结构时必须新增迁移并同步提升 Manifest 版本，不能静默解释旧配置。
- 插件下线后，其他 Section 保存无需重写未知插件实例。

## 7. 安全规则

- 配置只存 JSON 纯文本，不存任意 HTML。
- 跳转字段只能使用站内路径。
- 图片和文件字段只保存媒体 URL；文件生命周期归 `media` 模块所有。
- 插件不得绕过 `site.write` 权限、CSRF、Origin 校验或审计。
- 运行期第三方插件需要独立沙箱、权限和资源限制，不能直接复用本契约进入当前 Go 进程。
