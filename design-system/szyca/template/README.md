# szyca 数字深空设计模板

> 模板版本：`1.0.0`
>
> 归属：`szyca` 项目自有
>
> 上游：无；不依赖 `Li&Design` 子模块

## 内容

| 文件 | 用途 |
|---|---|
| `tokens.css` | 从运行时 `frontend/src/index.css` 导出的完整令牌快照 |
| `tokens.json` | 机器可读的 primitive / semantic / compatibility / fullscreen token |
| `components.css` | 从运行时 `frontend/src/cosmos.css` 导出的组件视觉快照 |
| `manifest.json` | 版本、权威路径、字体、视觉签名和 SHA-256 校验 |

完整品牌与组件规则仍以：

- `design-system/szyca/BRAND.md`
- `design-system/szyca/MASTER.md`

为准。

## 新项目复用

1. 将整个 `template/` 复制到目标项目的 `design-system/<project>/template/`。
2. 优先复用 `tokens.css` 的变量，再按目标产品的信息架构选择 `components.css` 中的组件片段。
3. 替换品牌文案、Logo 和内容，不改变深空视觉的 56px 网格、青色主信号与紫色点缀比例。
4. 字体使用 Noto Sans SC、Space Grotesk、JetBrains Mono。
5. 复用 90 节点 / 110px 连线 / 190px 鼠标引力 Canvas；在 `prefers-reduced-motion` 下改为静态星座。
6. 在目标项目中重新生成自己的模板快照，不直接引用 `szyca` 仓库路径。

## 当前视觉签名

- 背景：`#05070B → #0A0E1A`
- 主强调：`#00E5FF`
- 副强调：`#8B5CF6`，仅作点缀
- 固定网格：56px
- Canvas 节点：90
- 自动连线距离：110px
- 鼠标引力范围：190px
- 移动导航 / 模块单列断点：820px
- 卡片圆角：10–14px
- 页面级标题：居中、无框、38–56px

## 维护

禁止手动编辑生成文件。修改运行时视觉后，在仓库根目录运行：

```bash
python3 scripts/export_design_template.py --write
python3 scripts/export_design_template.py --check
```

参考截图：

- [桌面首页](../../../artifacts/browser/screenshots/home-on-1440.jpg)
- [移动首页](../../../artifacts/browser/screenshots/home-on-390.jpg)
- [后台概览](../../../artifacts/browser/screenshots/admin-overview-390.jpg)
