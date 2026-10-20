# Handoff

最后更新：2026-10-20。**排行榜展示三组变更（PK 主积分表述澄清、证据深度摘要、固定来源组合对照）已完成开发与全量验证；提交、推送与 CI 终态以版本库和 GitHub Actions 为准。** 以下“当前状态”优先于后面的历史记录。

## 当前状态：本轮交付（已交付）

### 规则与决策

- 排行榜展示三组变更同批交付，提案归档于 `openspec/archive/2026-10-20-*/`（其中 PK 表述澄清与来源组合对照两份 proposal 为归档时按已实现行为补记）：
  1. **PK 主积分表述澄清**：全站「综合分 / 融合积分」改名「PK 主积分」，辅助分统一表述为「榜单位次均值（仅 PK 同分排序）」——不作第五票、不与主积分再次合并、不参与帕累托与支配判断。数值计算零变化。
  2. **证据深度摘要**：融合榜评分说明处一行摘要（进入排名的模型数 / 占比，仅 2 榜裁决与 3 榜以上裁决的占比），`evidenceDepth` 在 `src/portal.mjs`，纯展示衍生，不进分享链接。
  3. **固定来源组合对照**：融合榜新增来源组合选择器（`coverageCohorts`，每队列只用所选来源计票）与对局覆盖明细（双方共有 2 / 3 / 4 榜对局数，进悬浮战绩、对比页与 CSV）；分享链接新增 `cm` 参数，ADR-0002 已补记。
- 主榜计票、成本口径、前沿判定均不变；三组都属展示与对照层。
- **源站抓取重试加固**（同批一并交付）：`requestSource` 超时提高到 45 秒，超时 / 网络错误 / 408 / 425 / 429 / 5xx 自动重试一次，响应体读取纳入重试范围；LiveBench 候选文件 404 仍按「换下一布局」处理，仅可重试错误才向上抛失败整站；`fetchArena` 保留重试。

### 验证证据（2026-10-20 本机）

- 单测 118/118；覆盖率行 98.39 / 分支 92.58 / 函数 96.14（门禁 92 / 85 / 90）；ESLint、Stylelint、Prettier、build 全绿。
- 4317 生产服务按最终构建重启；真实刷新四源全部成功（arena 416 / aa 706 / vals 50 / livebench 48）。
- 三套 E2E 全绿（`test:e2e` / `test:portal` / `test:evidence`），pageErrors / errors 均空。

### 给下一棒的坑（本轮新增）

- **hyparquet 的 `parquetReadObjects` 只收真 ArrayBuffer**：`getBuffer` 返回 Node Buffer，喂给 Arena Parquet 解析会抛 "First argument to DataView constructor must be an ArrayBuffer"；`crypto.subtle` 路径（AA 加密数据）可以吃 Buffer——两条路径别混用返回类型，`fetchArena` 必须经 `response.arrayBuffer()`。

- **`cm` 合法性硬编码在 `src/share.mjs` 的 `validCoverageMask`**：来源须属 `shared/sources.mjs` 白名单、按白名单顺序 `+` 连接、至少两个且不重复。`analysis.coverageCohorts` 的排序（来源数降序、其次覆盖模型数降序）决定「不带 `cm` 的分享」默认恢复到哪个对照——改排序即改默认组合。
- **`evidenceDepth` 的两个占比用「有向计数 ÷ 总有向计数」计算**：每场对决双方各计一次，先求和再除 2 还原场次；两个占比因此精确互补到 100，不要改成 `100 - x` 的浮点写法。
- **`coverageCohorts` 按 2^来源数 − 1 个掩码枚举队列并逐队列两两对决**：四来源下开销可忽略；未来若加第五个评分来源，需重新评估组合数与计算成本。
- 上一轮 Arena 的坑仍然全部有效，见下方历史记录。

## 上一轮交付：Arena 第四评分来源（2026-10-19，历史）

- 规则要点：四榜各一票、2∶2 平局、Arena 只取 `overall`、不引入新权重或原始分混算（ADR-0013）；额外权威榜单调研结案均不纳入（`docs/source-assessment.md`），后续纳入新来源需 owner 点名并更新 ADR。
- 摄取要点：官方单文件 Parquet + `hyparquet`（仅服务端依赖，不进前端 bundle）；`store.mjs` 只认 `ingestFormat: arena-text-overall-v1` 的新缓存，旧 Arena 缓存清理重取；`history.mjs` 归档票数 / 区间 / 发布日期。

### 给下一棒的坑（Arena 摄取与展示）

- **V8 `Date.parse("2026-02-30")` 返回合法时间戳（滚动进位）**：Arena 发布日期用 `isValidArenaDate` 做正则 + `Date.parse` + UTC 分量回读三重校验，不要退回只查正则和 parse。
- Arena 快照共 29 个 category，只有 `overall` 是全量聚合（416 条），其余是语言 / 难度 / 领域切片；取多档会重复计票同一批对话。
- `source-card` 内 metric 与 notes 都含「人类盲测偏好」字样，E2E 定位用完整 metric 文本避免 strict 冲突。
- 详情抽屉单榜区标题带「源数据」链接，可访问名以来源名开头而不是完全相等。

### 临时证据（仅本机，可能被清理）

- `/tmp/model-frontier-arena-latest.parquet`：真实下载快照；`/tmp/model-frontier-arena-overall.json`：筛选后 416 配置。
- HELM / Epoch 调研原件：`/tmp/model-frontier-extra-*`、`/tmp/model-frontier-helm-*`。

## 上次已推送交付（历史记录）

本次按用户授权将全部变更提交到 main 并推送 origin/main。本文记录提交前已完成的本地验证；远端 Actions 结果以对应提交的 CI 终态为准，交付回复提供提交和运行链接。

- 唯一评分规则：至少两榜有效分准入；双方至少两榜重合才对决，三榜各一票，按各榜原始分比较胜负。对决积分为 `100 × (胜场 + 0.5 × 平局) / 实际对手数`；没有实际对手时无积分与名次。最终积分相同，再按可用榜单名次百分位的等权平均辅助排序；两分均相同则并列。辅助分以精确分数求和，避免浮点加法误拆并列。
- 主图帕累托与综合榜使用同一分析结果，以主积分和所选成本判断支配关系，辅助分不参与帕累托；成本敏感性单独使用评分和成本齐全的样本。不同模型的对手集合可能不同，页面披露实际对手数，只有单榜重合的对决不计战绩。
- 移除旧评分公式、权重配置、最低覆盖选择与兼容迁移；旧链接的评分参数不再恢复旧算法。完整默认分享也输出带问号的状态链接，避免继承接收者本机偏好。
- 删除覆盖口径差异面板和数据提示列；详情仍保留证据。闭源与未知散点及图例改为不透明蓝色。
- LiveBench 支持紧凑日期与虚线日期发布、多种 CSV 布局、HTML 空壳识别；保留发布 ID 和独立显示日期映射。
- 数据文件退出 Git（ADR-0007），本机缓存仍保留；CI 显式刷新真实数据后执行 E2E，任一来源失败即失败。
- 六个提案归档到 `openspec/archive/2026-10-19-*/`；早期等权和三榜准入提案属于历史过程，当前规格以 ranking、share-link 与 ADR-0011 / ADR-0012 为准。

## 上次已推送版本验证证据

完成两轮评审并修复默认分享状态、辅助分浮点并列与 LiveBench 日期标签三个已证实缺陷。92 个单测全过；覆盖率行 97.80%、分支 92.12%、函数 95.85%（门禁 92 / 85 / 90）；build、ESLint、Stylelint、Prettier、三套 E2E 全绿。额外随机核验 80 组、5654 次模型对决通过。生产服务已按新构建重启于 4317。源码修改后必须重新执行 AGENTS.md 的完整验证流程。

## 上一轮清理（承接后可选阅读）

AA 修复交付后又做了一轮针对性清理，均已验证：`getText` / `getBuffer` 两份重复的 fetch 收敛为共用的 `requestSource`（只差 `Accept`，按各自原值参数化，行为零变化）；`lbMetadata` 的四个键改用预编译正则表，既免去每条模型解析都重编正则，也去掉动态构造正则的告警；`fetchLivebench` 与 `history.mjs` 的 `.reverse()` 改 `.toReversed()`（Node ≥ 20，项目要求 ≥ 22.12）；`history.mjs` 两处嵌套三元分别提取为 `view()` 里的 `items` / `visibleItems` 与 `diffSnapshots` 用的具名 `changeType(old, next)`；`pnpm-lock.yaml` 加入 `.gitignore`（项目用 npm，该文件是 pnpm 实验残留）。清理后 `server/adapters.mjs`、`server/history.mjs`、`server/store.mjs` 三个文件零诊断。

**未做**：全院约 40 处 `nested-ternary-js` 与 `no-console-except-error-js` / `hardcoded-url-js` 告警。前者遍布 `src/*.jsx` 与 `src/analysis.mjs`（评分代码，嵌套三元是承重逻辑），纯风格重写、零功能收益且回归风险高；后两者分别是服务启动横幅 / CLI 输出与「只监听 127.0.0.1:4317」的既定设计，均非缺陷。这些规则也不在仓库门禁内（`npm run lint` 是 ESLint）。

## 前次 AA 摄取交付（历史背景）

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

单 job 顺序执行：`npm ci` → lint / lint:css / format:check → test:coverage → build → `npm run refresh` → 启动生产服务（`npm start` + 轮询 `/api/status` 就绪，上限 30 秒）→ 三套 E2E → 失败时上传 `test-artifacts/` 截图。另有 concurrency 取消上一轮、`contents: read` 最小权限、15 分钟超时。

约定与坑：

- runner 固定 `ubuntu-26.04`（GitHub 托管镜像，`actions/runner-images` 已发布；`ubuntu-latest` 会随官方迁移漂移，故显式钉版本）。actionlint 内置标签库滞后于镜像发布，`.github/actionlint.yaml` 登记了该标签——删掉该配置会重现 "unknown label" 误报。
- 三个第三方 action（checkout / setup-node / upload-artifact）钉完整提交 SHA 防供应链改写，版本号写在行尾或上方注释；升级 action 时 SHA 与注释必须一起改。checkout 关了 `persist-credentials`（CI 不需要 git 凭据）。
- 本地没有 actionlint / yamllint，改完工作流至少跑 `npx prettier --check .github/`；YAML 行宽按 80 字符（CJK 按字符计，不按字节），`uses:` 行放长 SHA 时把版本注释移到上方独立行。
- CI 上 AA 单站刷新约 14–21 秒（见下），仍在 15 分钟总预算内。数据文件退出版本控制后（ADR-0007），CI 在构建后显式执行 `npm run refresh` 落数据再跑 E2E：任一站失败步骤即红，不再有「读仓库快照」的隐式兜底。

## 实现要点与坑（改 `server/adapters.mjs` 的 AA 链路前必读）

- **manifest 在原始 HTML 里是转义形态**：Flight 分片是 JS 字符串字面量，引号全部写成 `\"`，因此 `MANIFEST_RE` 必须容忍 `\\?"` 而不是直接匹配 `"manifest":{"path":...}`；否则在浏览器 DevTools 里看着对、代码里永远匹配不上。
- **解密后还有一层 gzip**：`crypto.subtle.decrypt` 出来的是 gzip 字节，漏掉 `gunzipSync` 会得到乱码且不报错——要到 `JSON.parse` 才失败，容易误判成加密方案变更（错误信息已区分「解密失败」与「解压或解析失败」）。
- **`initialModels` 只有 273 条且 0 条 deprecated**：拿它当全量用不会崩，只会安静少掉六成模型和全部历史 / 估算配置，属于最难发现的一类回归——这正是跌幅闸门存在的原因。
- **官方免费 API 的 1 位小数是服务端行为**，不是显示层四舍五入，客户端无法恢复精度。
- **AA 单站耗时几乎全是网络**：本地实测三轮，页面约 5–9 秒、数据文件（约 140 KB）约 8–12 秒，而解密 + gunzip + 解析合计仅约 25 毫秒。ADR 里若再出现「0.3–0.7 秒」一类数字，那是只量了本地计算，属失实。
- **开放权重闸门的分母是可评估的对象行数**，不是 `models.length`：否则载荷里混进 `null` 会把「全都有标记」误判成缺失，报错信息也会指错方向。
- **三站抓取统一走 `requestSource`**：`getText` / `getBuffer` 只差 `Accept`（前者按原值传 `text/html,application/json,text/csv,*/*`，后者用默认 `*/*`），改抓取行为只改这一处。`lbMetadata` 的 `scalar` 查预编译正则表 `LB_SCALAR_RE`，**未登记的键返回 null**——不要图省事改成 `match(undefined)`，那会命中整个 body。
- **`parseAA` 的行过滤必须防非对象条目**：`null.name` 会抛 TypeError，该函数上方闸门本就写了 `m && typeof m === "object"`，两处标准要一致。

## 实现要点与坑（改 `src/Chart.jsx` 前必读）

- **驱动事件用 `mousemove` 不是 `mouseover`**：zrender 的 `_hovered` 在指针离开画布时不重置，重新进入并停在同一元素上不会补发 `mouseover`，区域会「消失后不回来」。
- **单次 mousemove 内的派发顺序是 `mouseout`(旧点) → `mousemove`(新点) → `mouseover`(新点)**：撤下用 60ms 延迟定时器，因此 `paintZone` 必须先 `clearTimeout(retract)` 再绘制，否则点对点迁移后新区域会被旧点的待执行撤下抹掉（这个 bug 出现过一次，回归测试请覆盖「A→B 静止后区域仍在」）。
- **markArea 按系列 `id` 合并**：第二个特效用 `notMerge` 整表重建会抹掉区域，故 `paintedZone.current` 每次重算时置 null；区域用轴坐标（`xAxis`/`yAxis`）而非像素，平移缩放自动跟随。
- **E2E 锚点类名**（`AGENTS.md` 有清单）：`evidence-badges` 已无 E2E 引用（`evidence-e2e` 改定位 `.ranking-main-table tr[data-row-key]`），但类与 CSS 仍保留；新增锚点是 `creator-chip`。
- **Tailwind 残余层三条铁律与 exhaustive-deps 豁免**见 `AGENTS.md`，动图表特效前先读。

## 待办与已知取舍

- **跌幅闸门无人工 override**：若 AA 合法地永久缩水（有效分从 ≥200 条掉到不足一半），闸门会一直拒收并把源站标 stale，只能人工介入。这是刻意的 fail-safe 取舍（宪法诚实性优先：宁可显式报错，不静默少数据），加 override 属新功能，未做。
- **AA 的 `sourceDate` 仍为 `null`**：官方免费 API 的 `intelligence_index_version`（实测 4.3）在 manifest 载荷里没有对应字段，页面「数据时间」对这一栏继续不可用。
- **Pro 档升级路径**：若升级，可把官方 `/api/v2/language/models` 提为首选源、manifest 端点降级为兜底；届时需另立 ADR，因为免费档字段缺口正是本次不选它的原因。
- **既有 lint 告警已清理**（承接时登记的两条）：`scalar()` 的动态正则改为预编译正则表、`fetchLivebench` 的 `.reverse()` 改 `.toReversed()`。全院剩余的 `nested-ternary-js` / `no-console-except-error-js` / `hardcoded-url-js` 见上一节「未做」的说明，均非缺陷且不在仓库门禁内。
- **诊断噪声**：pi-lens 的嵌套三元（`nested-ternary-js`，全院既有风格）、antd 弃用提示为既有；knip 的「Unused export」是误报（项目未装 knip，`fetchAA` 根本没导出，`aaManifest` / `decryptAAGzip` 被 `fetchAA` 与测试引用）。
- **chip 计数口径**：取当前视图完整行池（与厂商下拉选项池一致），不被搜索 / 开放状态裁剪；因此在「仅开放权重」等筛选下可能出现 chip 计数大于可见行数——与既有下拉行为相同，属既定取舍。
- **斩杀区在口径切换后不自动重绘**：切成本口径 / 图例 / 聚焦会整表重建并抹掉区域，需移动鼠标才会重新出现（tooltip 同样等到下次移动才刷新，行为一致）。

## 文件地图

- `src/Chart.jsx` 前沿散点 / 斩杀区；`src/main.jsx` 探索页（应用外壳、分享状态、模型全景表）；`src/Portal.jsx` 门户六页（排行榜 / 对比 / chip）。
- `src/analysis.mjs` 评分、帕累托与来源组合队列（`coverageCohorts`；`dominatedBy` 在此计算，供斩杀区与 tooltip 共用）；`src/portal.mjs` 榜单行池、证据深度摘要与导出；`src/share.mjs` 分享链接编解码；`src/Evidence.jsx` 证据徽标。
- `server/adapters.mjs` 三站摄取（AA 走 manifest 加密链路，见上）；`server/store.mjs` 抓取编排与落库闸门；`server/index.mjs` 单服务前后一体 + 定时抓取；`data/snapshot.json` 为聚合产物（已退出版本控制，ADR-0007）。
- 规格在 `openspec/specs/<能力>/spec.md`；ADR 在 `docs/adr/`。
