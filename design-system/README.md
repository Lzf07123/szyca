# szyca 项目设计系统

本目录是 `szyca` 项目自有的视觉设计来源，不依赖 `Li&Design` 共享子模块，也没有跨项目复制视觉文件。

## 权威关系

| 层级 | 文件 | 作用 |
|---|---|---|
| 品牌与设计规则 | `design-system/szyca/BRAND.md` | 品牌语气、视觉方向、字体与无障碍 |
| 总设计规范 | `design-system/szyca/MASTER.md` | 色彩、组件、动效、响应式与验收 |
| 页面覆盖 | `design-system/szyca/pages/*.md` | 首页、抽奖、后台等页面差异 |
| 项目模板 | `design-system/szyca/template/` | 可复制、可校验的深空设计快照 |
| 运行时令牌 | `frontend/src/index.css` | 页面和组件实际消费的唯一令牌源 |
| 运行时组件视觉 | `frontend/src/cosmos.css` | 深空组件、响应式和状态实现 |

## 项目边界

- `szyca` 不属于 `Li&` 系列，不使用 `Li-Design` 子模块。
- 当前目录没有 `.gitmodules`，运行时前端也不引用任何 `Li&Design` 文件。
- 设计模板是快照导出，不反向成为运行时依赖；修改视觉时先改 `index.css` / `cosmos.css`，再重新导出模板。
- 禁止直接编辑 `template/tokens.css`、`template/components.css`、`template/tokens.json` 或 `template/manifest.json`。

## 模板导出与校验

```bash
python3 scripts/export_design_template.py --write
python3 scripts/export_design_template.py --check
```

`--check` 同时验证：

- 模板快照与运行时 CSS 哈希一致；
- 模板声明为项目自有，`derivedFrom = null`；
- `.gitmodules` 未重新引入 `Li&Design`；
- 前端运行时代码未引用 `Li&Design`。
