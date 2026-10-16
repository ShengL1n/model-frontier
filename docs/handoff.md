# Handoff

最后更新：本次交付提交后（`main`，推送至 `origin/main`）。面向接手会话：先读本文件，再读 `AGENTS.md` 与 `openspec/specs/`。

## 当前状态

- 本地工作区干净，无未提交改动；`dist/` 为最近一次 `npm run build` 产物，服务（`npm start`，4317 端口）运行中。
- 全量门禁绿：78 单测、覆盖率 94.13 / 87.55 / 93.75（门禁 92 / 85 / 90）、ESLint、Prettier、stylelint、三套 E2E（`test:e2e` / `test:portal` / `test:evidence`）。
- 数据由服务端定时刷新写入 `data/snapshot.json` / `data/history.json`；这类例行刷新按既有约定单独以 `chore:` 提交。

## 本次交付内容

1. **斩杀区跟随鼠标**（原静态「被支配区」质疑的落地）：前沿图悬浮任一全球前沿模型，即画出它支配的右下方矩形并注明「被 X 支配 · N 个模型」；被支配模型的 tooltip 反向点名支配者。矩形挂在「全球前沿」系列上，随图例显隐。实现见 `src/Chart.jsx`（`paintZone` / `zoneContext` / `paintedZone`）。
2. **配置徽标去噪**：`EvidenceBadges` 只渲染条件性证据标签，无标签返回 null；配置一致性徽标下沉到 `ConfigurationDetails` 头部（详情 / 对比页）。前沿探索模型表删除「配置 / 数据」列；融合排行榜该列改名「数据提示」。依据：全量 512 行中 506 行（98.8%）是同一句「配置信息不足」。
3. **厂商快捷筛选 chip**：探索页与排行榜模型表上方的 chip 行，与厂商下拉同源、只改变显示，激活态经 `cr` 入分享链接。`src/portal.mjs` 的 `VENDOR_CHIPS` / `vendorChipCounts`，组件 `CreatorChips`（`src/Portal.jsx`）。
4. **分享链接补全探索页显示状态**：`cr`（厂商）与 `of`（仅看前沿）编码进锚点，`src/share.mjs` 增加 `of` 键。

## 运行与验证

```bash
npm start            # 生产服务，http://localhost:4317（dist/ 为构建产物目录）
npm run build        # 改 src/ 后必须重建并重启服务才生效
npm test             # 单测（node --test）
npm run test:coverage # 带门禁的覆盖率
npm run lint && npm run format:check && npm run lint:css
npm run test:e2e && npm run test:portal && npm run test:evidence
```

浏览器实测必须用 `chromium.launch({ channel: "chrome", headless: true })`——playwright 自带的 headless shell 未安装。E2E 默认打 `http://localhost:4317`，可用 `FRONTIER_URL` 覆盖。

## CI（`.github/workflows/ci.yml`）

单 job 顺序执行：`npm ci` → lint / lint:css / format:check → test:coverage → build → 启动生产服务（`npm start` + 轮询 `/api/status` 就绪，上限 30 秒）→ 三套 E2E → 失败时上传 `test-artifacts/` 截图。另有 concurrency 取消上一轮、`contents: read` 最小权限、15 分钟超时。

约定与坑：

- runner 固定 `ubuntu-26.04`（GitHub 托管镜像，`actions/runner-images` 已发布；`ubuntu-latest` 会随官方迁移漂移，故显式钉版本）。actionlint 内置标签库滞后于镜像发布，`.github/actionlint.yaml` 登记了该标签——删掉该配置会重现 "unknown label" 误报。
- 三个第三方 action（checkout / setup-node / upload-artifact）钉完整提交 SHA 防供应链改写，版本号写在行尾或上方注释；升级 action 时 SHA 与注释必须一起改。checkout 关了 `persist-credentials`（CI 不需要 git 凭据）。
- 本地没有 actionlint / yamllint，改完工作流至少跑 `npx prettier --check .github/`；YAML 行宽按 80 字符（CJK 按字符计，不按字节），`uses:` 行放长 SHA 时把版本注释移到上方独立行。

## 实现要点与坑（改 `src/Chart.jsx` 前必读）

- **驱动事件用 `mousemove` 不是 `mouseover`**：zrender 的 `_hovered` 在指针离开画布时不重置，重新进入并停在同一元素上不会补发 `mouseover`，区域会「消失后不回来」。
- **单次 mousemove 内的派发顺序是 `mouseout`(旧点) → `mousemove`(新点) → `mouseover`(新点)**：撤下用 60ms 延迟定时器，因此 `paintZone` 必须先 `clearTimeout(retract)` 再绘制，否则点对点迁移后新区域会被旧点的待执行撤下抹掉（这个 bug 出现过一次，回归测试请覆盖「A→B 静止后区域仍在」）。
- **markArea 按系列 `id` 合并**：第二个特效用 `notMerge` 整表重建会抹掉区域，故 `paintedZone.current` 每次重算时置 null；区域用轴坐标（`xAxis`/`yAxis`）而非像素，平移缩放自动跟随。
- **E2E 锚点类名**（`AGENTS.md` 有清单）：`evidence-badges` 已无 E2E 引用（`evidence-e2e` 改定位 `.ranking-main-table tr[data-row-key]`），但类与 CSS 仍保留；新增锚点是 `creator-chip`。
- **Tailwind 残余层三条铁律与 exhaustive-deps 豁免**见 `AGENTS.md`，动图表特效前先读。

## 待办与已知取舍

- **`pnpm-lock.yaml`（未跟踪）**：本项目用 npm（`package-lock.json`），该文件是早前 pnpm 实验残留，未提交。确认无用后可删除或加入 `.gitignore`。
- **chip 计数口径**：取当前视图完整行池（与厂商下拉选项池一致），不被搜索 / 开放状态裁剪；因此在「仅开放权重」等筛选下可能出现 chip 计数大于可见行数——与既有下拉行为相同，属既定取舍。
- **斩杀区在口径切换后不自动重绘**：切成本口径 / 图例 / 聚焦会整表重建并抹掉区域，需移动鼠标才会重新出现（tooltip 同样等到下次移动才刷新，行为一致）。
- **诊断噪声**：pi-lens 的嵌套三元、antd 弃用提示为全院既有风格；knip 的「Unused export CreatorChips」是误报（项目未装 knip，该导出被 `src/main.jsx` 引用）。

## 文件地图

- `src/Chart.jsx` 前沿散点 / 斩杀区；`src/main.jsx` 探索页（应用外壳、分享状态、模型全景表）；`src/Portal.jsx` 门户六页（排行榜 / 对比 / chip）。
- `src/analysis.mjs` 评分与帕累托（`dominatedBy` 在此计算，供斩杀区与 tooltip 共用）；`src/portal.mjs` 榜单行池与导出；`src/share.mjs` 分享链接编解码；`src/Evidence.jsx` 证据徽标。
- `server/index.mjs` 单服务前后一体 + 定时抓取；`data/snapshot.json` 为聚合产物。
- 规格在 `openspec/specs/<能力>/spec.md`；ADR 在 `docs/adr/`。
