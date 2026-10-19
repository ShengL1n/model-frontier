# 额外来源调研（2026-10-19）

来源数量不等于独立证据数量。标准是公开可复核、适合综合比较、仍在更新、配置可识别、自动获取可验证；同一机构子榜、托管平台和二次聚合不重复计票。不同评测仍可能共享任务，不宣称四票统计独立。

| 来源                                                                                                                          | 核验结果                                                                                                             | 本次处理                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [Arena 官方数据](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)                                              | text/latest/overall，416 配置，2026-10-15；后台下载及解码成功                                                        | 纳入一票，保留票数、源区间与配置；不提供成本   |
| [Hugging Face Open LLM Leaderboard](https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard/discussions/1135) | 官方在 2025-03-13 宣布结束维护；Hugging Face 本身是托管平台                                                          | 不作为当前综合榜的一票                         |
| [Stanford HELM Capabilities](https://crfm.stanford.edu/helm/capabilities/latest/)                                             | 实测 config.js 为 v1.15.0；公开 summary.json 的 date 为 2025-11-24，缺乏当前前沿模型的同期可比覆盖                   | 不接入当前投票；不能用最近抓取时间掩盖发布陈旧 |
| [Epoch ECI](https://epoch.ai/eci)                                                                                             | 官方 eci_scores.csv 可下载，但 eci_benchmarks.csv 的 source 含厂商技术报告、Stanford CRFM、Vals 等，属于多方二次聚合 | 不作为额外独立票，避免重复放大相同结果         |

**结论（owner 2026-10-19 裁定）**：Arena 之外，HF Open LLM、HELM、Epoch ECI 三来源均不纳入，本项调研结案。当前评分固定为 AA、Vals、LiveBench、Arena 四票；后续纳入任何新来源需 owner 点名并更新 ADR（与 ROADMAP「明确不做」一致）。

HELM 核验文件：[config.js](https://crfm.stanford.edu/helm/capabilities/latest/config.js)、[summary.json](https://storage.googleapis.com/crfm-helm-public/capabilities/benchmark_output/releases/v1.15.0/summary.json)。Epoch 核验：[scores](https://epoch.ai/data/eci_scores.csv)、[底层来源](https://epoch.ai/data/eci_benchmarks.csv)。这些结论是本次获取时观察，不宣称源站永久停止更新。

代码、数学等专项榜有价值，但本工具当前融合目标是通用模型选择；直接把多项代码专项榜各算一票会隐式增加代码权重，因此本次不扩展专项投票。
