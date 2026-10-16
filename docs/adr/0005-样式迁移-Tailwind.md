# ADR-0005：样式迁移到 Tailwind v4 工具类

- 状态：已接受
- 日期：2026-10-16
- 决策人：owner（会话插话指令「请使用 tailwind」）

## 背景

项目原为单文件手写 CSS（约 3200 行），随功能分区追加式生长。owner 指示改用 Tailwind。

## 决策

- 引入 Tailwind v4（`@tailwindcss/vite`），组件样式改为 JSX 内工具类，原自定义类随之删除。
- **跳过 preflight**（只引入 `theme.css` 与 `utilities.css`），避免重置样式破坏 antd 默认外观。
- 设计令牌集中在 `@theme`（ink/muted/green/line/surface/shadow-card），其余颜色用任意值语法原样保留，保证视觉保真。
- 残余层保留三类规则：antd 内部覆盖（父级限定选择器，靠特异性压过运行时 cssinjs）、`:fullscreen` 等状态选择器、全局基础样式。
- 工具类不与 antd 组件内部样式对抗：凡需要覆盖 .ant-* 的，一律走残余 CSS。

## 后果

- JSX 中类名变长，但样式与标记同址，删除组件即删除样式。
- 级联规则：残余 CSS（无 layer）> 工具类（layer(utilities)）> `@layer base`；新增覆盖类样式时优先写残余 CSS 并注明原因。
- 断点变体统一用 `@custom-variant` 定义的 `max-1180` / `max-1000` / `max-760`（含边界 `width <= Npx`），不用内置 `max-[Npx]:`——后者编译为严格小于（`width < Npx`），与残余层媒体查询在恰好 Npx 视口（浏览器缩放易命中）出现一边切换一边不切的混合状态（2026-10-16 评审修正）。
- 视觉回归的主要防线是三套 E2E + 六页截图比对（迁移时做过前后比对）。

## 实施中发现的坑（2026-10-16 迁移当日记录）

- **`@import url("tailwindcss/...")` 会让 Tailwind 静默失效**：stylelint 默认把字符串导入改写为 url() 记法，Tailwind 解析器不展开这种包导入，产物里零工具类且构建不报错。已在 stylelint 配置强制 `import-notation: "string"`。此类问题靠截图比对才能暴露，构建全绿不代表样式生效。
- **antd 运行时样式压制层内工具类**：antd 6 的 cssinjs 注入 `.anticon { color: inherit }` 等无层规则，同元素上写工具类永远输。凡需覆盖 .ant-* 的样式一律走残余层。
- **E2E 锚点类必须在 JSX 上保留**：三套 E2E 用 `locator(".preset-cards>div")` 等类名定位，迁移时删类会静默破坏测试；锚点类可与工具类共存。
- 残余层中部分锚点类自身块与 JSX 工具类等值双写（迁移时为保证零回归采取的保守策略），后续清理时须先删 JSX 侧依赖认知再动 CSS。
