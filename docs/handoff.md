# Handoff

最后更新：本次交付（AA 摄取修复）提交后，`main`，随后推送至 `origin/main`。面向接手会话：先读本文件，再读 `AGENTS.md` 与 `openspec/specs/`。

## 当前状态

- 本地工作区干净，仅剩未跟踪的 `pnpm-lock.yaml`（早前 pnpm 实验残留，项目用 npm，见文末待办）；`dist/` 为最近一次 `npm run build` 产物，服务（`npm start`，4317 端口）运行中。
- 全量门禁绿：81 单测、覆盖率 94.96 / 88.67 / 94.67（门禁 92 / 85 / 90）、ESLint、Prettier、stylelint、三套 E2E（`test:e2e` / `test:portal` / `test:evidence`）。
- **AA 摄取已修复并真实刷新成功**：`data/snapshot.json` 落库 AA 704 行（379 开放权重 / 431 历史 / 473 估算 / 196 条含成本），三站均 `error: null`。
- 数据由服务端定时刷新写入 `data/snapshot.json` / `data/history.json`；这类例行刷新按既有约定单独以 `chore:` 提交。

## 本次交付内容

1. **AA 摄取改用页面 manifest 加密端点**（`docs/adr/0006`）：源站改版后全量 704 行不再随页面下发，原 Flight `models` 数组解析稳定失败（报「找不到含开放权重元数据的模型数据」，而 Vals / LiveBench 同时成功、AA 页面 HTTP 200 正常返回 1.9MB——是摄取契约失效，非网络波动）。新链路为「页面取 manifest → 拉 `/data/<hash>.txt` → AES-256-GCM 解密 → gunzip → JSON」，密钥写在同一个 Flight 分片里。字段映射与旧解析逐字段一致，**口径不变**（不涉及 ADR-0003），三站仍无 key 运行。
2. **两道完整性闸门**，针对「不完整但格式合法」的静默退化：
   - 契约闸门（`server/adapters.mjs`）：少于 100 条、或超过 10% 行缺少布尔型 `isOpenWeights` 即拒绝。
   - 跌幅闸门（`server/store.mjs`，三站通用）：上次成功缓存有效分 ≥ 200 条而本次不足一半即拒绝，并说明条数。
3. **`tests/evidence-e2e.mjs` 去掉对本机设置的隐式依赖**：原先硬编码 `assert.equal(refreshHours, 1)`，改由测试自行 PUT 设定前提并在 `finally` 还原原值。换机器或改过刷新间隔不再莫名红掉（该值此前为 24，导致这套在本地必挂）。

官方 Data API 已评估但不采用：本机 key 为 Free 档，`/api/v2/language/models` 需 Pro；`free` 端点可取 704 条却按规范排除 licensing 等字段——没有 `isOpenWeights` / `deprecated` / 估算标记，且分数只给 1 位小数（相邻并列从 21 处增至 392 处）。manifest 端点是其严格超集且不需要 key。

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

注意：`node:test` 的 `mock.restore` 在本机 Node（v24）不存在，测试里改用显式保存 / 还原 `globalThis.fetch`。

## CI（`.github/workflows/ci.yml`）

单 job 顺序执行：`npm ci` → lint / lint:css / format:check → test:coverage → build → 启动生产服务（`npm start` + 轮询 `/api/status` 就绪，上限 30 秒）→ 三套 E2E → 失败时上传 `test-artifacts/` 截图。另有 concurrency 取消上一轮、`contents: read` 最小权限、15 分钟超时。

约定与坑：

- runner 固定 `ubuntu-26.04`（GitHub 托管镜像，`actions/runner-images` 已发布；`ubuntu-latest` 会随官方迁移漂移，故显式钉版本）。actionlint 内置标签库滞后于镜像发布，`.github/actionlint.yaml` 登记了该标签——删掉该配置会重现 "unknown label" 误报。
- 三个第三方 action（checkout / setup-node / upload-artifact）钉完整提交 SHA 防供应链改写，版本号写在行尾或上方注释；升级 action 时 SHA 与注释必须一起改。checkout 关了 `persist-credentials`（CI 不需要 git 凭据）。
- 本地没有 actionlint / yamllint，改完工作流至少跑 `npx prettier --check .github/`；YAML 行宽按 80 字符（CJK 按字符计，不按字节），`uses:` 行放长 SHA 时把版本注释移到上方独立行。
- CI 上 AA 单站刷新约 14–21 秒（见下），仍在 30 秒就绪轮询与 15 分钟总预算内；若 CI 网络不通，源站会标 stale，但 E2E 读的是提交进仓库的快照，不受影响。

## 实现要点与坑（改 `server/adapters.mjs` 的 AA 链路前必读）

- **manifest 在原始 HTML 里是转义形态**：Flight 分片是 JS 字符串字面量，引号全部写成 `\"`，因此 `MANIFEST_RE` 必须容忍 `\\?"` 而不是直接匹配 `"manifest":{"path":...}`；否则在浏览器 DevTools 里看着对、代码里永远匹配不上。
- **解密后还有一层 gzip**：`crypto.subtle.decrypt` 出来的是 gzip 字节，漏掉 `gunzipSync` 会得到乱码且不报错——要到 `JSON.parse` 才失败，容易误判成加密方案变更（错误信息已区分「解密失败」与「解压或解析失败」）。
- **`initialModels` 只有 273 条且 0 条 deprecated**：拿它当全量用不会崩，只会安静少掉六成模型和全部历史 / 估算配置，属于最难发现的一类回归——这正是跌幅闸门存在的原因。
- **官方免费 API 的 1 位小数是服务端行为**，不是显示层四舍五入，客户端无法恢复精度。
- **AA 单站耗时几乎全是网络**：本地实测三轮，页面约 5–9 秒、数据文件（约 140 KB）约 8–12 秒，而解密 + gunzip + 解析合计仅约 25 毫秒。ADR 里若再出现「0.3–0.7 秒」一类数字，那是只量了本地计算，属失实。
- **开放权重闸门的分母是可评估的对象行数**，不是 `models.length`：否则载荷里混进 `null` 会把「全都有标记」误判成缺失，报错信息也会指错方向。
- **`parseAA` 的行过滤必须防非对象条目**：`null.name` 会抛 TypeError，该函数上方闸门本就写了 `m && typeof m === "object"`，两处标准要一致。

## 实现要点与坑（改 `src/Chart.jsx` 前必读）

- **驱动事件用 `mousemove` 不是 `mouseover`**：zrender 的 `_hovered` 在指针离开画布时不重置，重新进入并停在同一元素上不会补发 `mouseover`，区域会「消失后不回来」。
- **单次 mousemove 内的派发顺序是 `mouseout`(旧点) → `mousemove`(新点) → `mouseover`(新点)**：撤下用 60ms 延迟定时器，因此 `paintZone` 必须先 `clearTimeout(retract)` 再绘制，否则点对点迁移后新区域会被旧点的待执行撤下抹掉（这个 bug 出现过一次，回归测试请覆盖「A→B 静止后区域仍在」）。
- **markArea 按系列 `id` 合并**：第二个特效用 `notMerge` 整表重建会抹掉区域，故 `paintedZone.current` 每次重算时置 null；区域用轴坐标（`xAxis`/`yAxis`）而非像素，平移缩放自动跟随。
- **E2E 锚点类名**（`AGENTS.md` 有清单）：`evidence-badges` 已无 E2E 引用（`evidence-e2e` 改定位 `.ranking-main-table tr[data-row-key]`），但类与 CSS 仍保留；新增锚点是 `creator-chip`。
- **Tailwind 残余层三条铁律与 exhaustive-deps 豁免**见 `AGENTS.md`，动图表特效前先读。

## 待办与已知取舍

- **`pnpm-lock.yaml`（未跟踪）**：本项目用 npm（`package-lock.json`），该文件是早前 pnpm 实验残留，未提交。确认无用后可删除或加入 `.gitignore`。
- **跌幅闸门无人工 override**：若 AA 合法地永久缩水（有效分从 ≥200 条掉到不足一半），闸门会一直拒收并把源站标 stale，只能人工介入。这是刻意的 fail-safe 取舍（宪法诚实性优先：宁可显式报错，不静默少数据），加 override 属新功能，未做。
- **AA 的 `sourceDate` 仍为 `null`**：官方免费 API 的 `intelligence_index_version`（实测 4.3）在 manifest 载荷里没有对应字段，页面「数据时间」对这一栏继续不可用。
- **Pro 档升级路径**：若升级，可把官方 `/api/v2/language/models` 提为首选源、manifest 端点降级为兜底；届时需另立 ADR，因为免费档字段缺口正是本次不选它的原因。
- **既有 lint 告警未清理**（均在本次改动范围外，pi-lens 报出但非仓库门禁）：`server/adapters.mjs` 的 `scalar()` 用 `new RegExp` 动态构造正则（Semgrep 潜在 ReDoS，输入是抓来的页面文本，实际风险低）；`fetchLivebench` 的 `.reverse()`（ast-grep 告警实为误报——作用在 `[...new Set()]` 新数组上，不污染共享状态）。
- **诊断噪声**：pi-lens 的嵌套三元（`nested-ternary-js`，全院既有风格）、antd 弃用提示为既有；knip 的「Unused export」是误报（项目未装 knip，`fetchAA` 根本没导出，`aaManifest` / `decryptAAGzip` 被 `fetchAA` 与测试引用）。
- **chip 计数口径**：取当前视图完整行池（与厂商下拉选项池一致），不被搜索 / 开放状态裁剪；因此在「仅开放权重」等筛选下可能出现 chip 计数大于可见行数——与既有下拉行为相同，属既定取舍。
- **斩杀区在口径切换后不自动重绘**：切成本口径 / 图例 / 聚焦会整表重建并抹掉区域，需移动鼠标才会重新出现（tooltip 同样等到下次移动才刷新，行为一致）。

## 文件地图

- `src/Chart.jsx` 前沿散点 / 斩杀区；`src/main.jsx` 探索页（应用外壳、分享状态、模型全景表）；`src/Portal.jsx` 门户六页（排行榜 / 对比 / chip）。
- `src/analysis.mjs` 评分与帕累托（`dominatedBy` 在此计算，供斩杀区与 tooltip 共用）；`src/portal.mjs` 榜单行池与导出；`src/share.mjs` 分享链接编解码；`src/Evidence.jsx` 证据徽标。
- `server/adapters.mjs` 三站摄取（AA 走 manifest 加密链路，见上）；`server/store.mjs` 抓取编排与落库闸门；`server/index.mjs` 单服务前后一体 + 定时抓取；`data/snapshot.json` 为聚合产物。
- 规格在 `openspec/specs/<能力>/spec.md`；ADR 在 `docs/adr/`。
