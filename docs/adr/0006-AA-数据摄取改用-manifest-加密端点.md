# ADR-0006：AA 数据摄取改用页面 manifest 加密端点

- 状态：已接受
- 日期：2026-10-17
- 决策人：owner（会话指令「没有 api 端点吗」→ 实测后选定 manifest 端点）

## 背景

AA（Artificial Analysis）原是三站中唯一靠解析 Next.js Flight 内嵌数据的一站：抓
`/leaderboards/models` 页面，从 `self.__next_f.push` 分片里找含 `isOpenWeights` 布尔值的
`models` 数组。2026-10-17 定时刷新起该解析稳定失败，报
「找不到含开放权重元数据的模型数据」，而同一次刷新里 Vals 与 LiveBench 均成功、AA 的
HTTP 200 也正常返回 1.9MB 页面——即非网络波动，是摄取契约失效。

改版后的实际情况：

- 页面 Flight 里的键从 `models` 改为 `initialModels`，且只嵌 **273** 条非历史模型
  （0 条 deprecated），全量 **704** 行不再随页面下发。
- 全量数据移到 `/data/<hash>.txt`，是 **AES-256-GCM 加密后 gzip 的 JSON**；密钥以 hex
  形式写在同一个 Flight 分片的 `manifest` 字段里，IV 取 `SHA-256(key)` 前 12 字节，
  tag 长 128 位。站点前端用 WebCrypto 解密。

同时评估了 owner 提示的官方 Data API（`https://artificialanalysis.ai/data-api/docs`，
密钥走 `x-api-key` 头，环境变量 `ARTIFICIAL_ANALYSIS_API_KEY`）：

- 本机 key 为 **Free 档**（100 次/24 小时窗口）。`/api/v2/language/models` 返回 403
  「requires a Pro subscription」。
- `/api/v2/language/models/free` 可通，能取到 704 条，但按规范**明确排除** licensing、
  全量评测、上下文窗口、性能分位等字段。实测逐字段比对：

  | 字段                                  | manifest 加密端点 | 官方免费 API |
  | ------------------------------------- | ----------------- | ------------ |
  | `isOpenWeights` 开放权重              | 704/704           | 无此字段     |
  | `deprecated` 历史配置                 | 431 条            | 无此字段     |
  | `intelligenceIndexIsEstimated` 估算分 | 473 条            | 无此字段     |
  | 分数精度                              | 全精度            | 1 位小数     |
  | 每任务成本                            | 196 条            | 196 条       |

  精度损失的后果可量化：全精度下相邻并列 21 处，四舍五入到 1 位小数后增至 **392 处**，
  榜单第 2、3 名即出现一对 `56.0 / 56.0` 被抹平；而排名分 `100 × (N − r) / (N − 1)` 对并列敏感。
  开放权重更致命——CONSTITUTION 第 1 条要求开放权重状态只依据源站披露，免费 API 不给
  这个字段，开放权重前沿与筛选器整体瘫痪。

**结论：manifest 加密端点是官方免费 API 的严格超集，且不需要 API key。**

## 决策

AA 摄取改为「页面取 manifest → 拉加密文件 → 解密解压 → JSON」，三站仍保持无 key 运行：

- `server/adapters.mjs` 删去 Flight 解析，新增 `aaManifest(html)`（纯函数，提 path/key）、
  `decryptAAGzip(buffer, keyHex)`（AES-GCM + gunzip）、`parseAA(models)`（纯函数，字段
  映射与契约校验）、`fetchAA()`（编排）。`FETCHERS.aa = fetchAA`。
- 字段映射与旧解析逐字段保持一致：`name = shortName ?? name`、`score = intelligenceIndex`、
  `costTask = intelligenceIndexCostPerTask`、价格/速度/延迟/厂商/开放权重/历史/估算标记与
  `url = /models/<slug>`。**口径不变**，不涉及 ADR-0003。
- 失败一律明确抛错并保留上次成功缓存（沿用 store 现有行为），不静默回退。

配套两道闸门，针对「不完整但格式合法」的静默退化：

1. **契约闸门**（adapters 内）：解析结果少于 100 条、或超过 10% 的行缺少布尔型
   `isOpenWeights`，即拒绝。前者挡空响应/挑战页，后者挡字段被摘除——若开放权重标记消失
   而仍放行，全表会退化成「开放状态未知」，比报错更糟。
2. **跌幅闸门**（store 内，三站通用）：上次成功缓存有效分 ≥ 200 条、而本次不足其一半时，
   拒绝替换缓存并说明条数。AA 全量约 700 条，若哪天 manifest 只下发当前模型（273 条），
   条数会从 704 静默塌到 273，旧解析与单纯改键名都发现不了。

## 后果

- 每次 AA 刷新从 1 个请求变为 2 个（页面 + 数据文件）。本地实测三轮：页面获取约
  5–9 秒、数据文件（约 140 KB）约 8–12 秒，而解密 + gunzip + 解析合计仅约 25 毫秒——
  耗时几乎全部在两次 HTTP 获取上，且随网络波动，与加密管道本身无关。AA 单站全程约
  14–21 秒，仍远小于刷新间隔（默认 6 小时），不改变刷新节奏；但相比改版前只抓页面，
  多了一次数据文件请求，这部分增量是真实的。
- 依赖面从「React Flight 分片结构 + 某个数组键名」收窄为「一个 manifest 正则 + 一套标准
  加密管道」。前者是 React 内部实现的副产物，后者是显式契约；但两者都不是官方承诺的公开
  API，AA 仍可能再次变更，因此闸门与明确报错比「猜新结构」更重要。
- 若 owner 后续升级到 Pro 档，可把官方 `/api/v2/language/models` 提为首选源（字段更全、
  有速率限制响应头与版本号），manifest 端点降级为兜底；届时需另立 ADR，因为免费档字段
  缺口正是本次不选它的原因。
- 已知遗留：官方免费 API 的 `intelligence_index_version`（实测 4.3）在 manifest 载荷里
  没有对应字段，AA 的 `sourceDate` 仍为 `null`，页面「数据时间」对这一栏继续不可用。

## 实施中发现的坑（2026-10-17 记录）

- **manifest 在原始 HTML 里是转义形态**：Flight 分片是 JS 字符串字面量，引号全部写成
  `\"`，因此正则必须容忍 `\\?"` 而不是直接匹配 `"manifest":{"path":...}`；否则在浏览器
  DevTools 里看着对、代码里永远匹配不上。
- **解密后还有一层 gzip**：`crypto.subtle.decrypt` 出来的是 gzip 字节，漏掉
  `gunzipSync` 会得到一堆乱码，且不报错——`JSON.parse` 才失败，容易误判成加密方案变更。
- **`initialModels` 只有 273 条且 0 条 deprecated**：拿它当全量用不会崩，只会安静地少掉
  六成模型和全部历史/估算配置，属于最难发现的一类回归。
- **官方免费 API 的 1 位小数不是显示层四舍五入**：服务端就只给 1 位，客户端无法恢复精度。
