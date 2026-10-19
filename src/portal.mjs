import { NAMES } from "./presentation.mjs";
export const SOURCE_IDS = Object.keys(NAMES);

// 并列同名次；没有综合分的模型保留在列表中，但不赋予名次。
export function rankedModels(rows) {
  const sorted = [...rows].sort(
    (a, b) =>
      (b.composite ?? -Infinity) - (a.composite ?? -Infinity) ||
      (b.auxiliary ?? -Infinity) - (a.auxiliary ?? -Infinity) ||
      a.name.localeCompare(b.name),
  );
  let last = null,
    lastAuxiliary = null,
    rank = null;
  return sorted.map((r, i) => {
    if (Number.isFinite(r.composite)) {
      if (last !== r.composite || lastAuxiliary !== (r.auxiliary ?? null))
        rank = i + 1;
      last = r.composite;
      lastAuxiliary = r.auxiliary ?? null;
      return { ...r, rank };
    }
    return { ...r, rank: null };
  });
}
export function filterModels(
  rows,
  { query = "", creator, openness = "all", scoredOnly = false } = {},
) {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!needle ||
        `${r.name} ${r.configuration ?? ""} ${r.creator}`
          .toLowerCase()
          .includes(needle)) &&
      (!creator || r.creator === creator) &&
      (openness === "all" ||
        (openness === "open" && r.openWeights === true) ||
        (openness === "closed" && r.openWeights === false) ||
        (openness === "unknown" && r.openWeights == null)) &&
      (!scoredOnly || Number.isFinite(r.composite)),
  );
}
// 厂商快捷筛选：与同行「全部厂商」下拉同源于 creator 字段，只改变显示，不参与评分。
// 固定编辑口径（非数据宣称）：全局基准 + 中国前沿各取最佳综合分领先的厂商，
// 覆盖帕累托前沿与顶尖性能两条线；标签用常见品牌名，note 只补充品牌名看不出的事实
// （tooltip 首段已给出源站 creator 字符串，note 不重复它）。
// 顺序按当前快照各厂商最佳综合分降序固定排布，不随筛选变化；激活态经 cr 参数入分享链接、随 CSV 导出入链。
// 完整 61 家始终保留在厂商下拉与搜索中，chip 只是快捷方式，不是白名单。
export const VENDOR_CHIPS = [
  { value: "Anthropic", label: "Anthropic" },
  { value: "Google", label: "Gemini" },
  { value: "Meta", label: "Meta", note: "Llama / Muse 系列" },
  { value: "OpenAI", label: "OpenAI" },
  { value: "Xiaomi", label: "MiMo" },
  { value: "DeepSeek", label: "DeepSeek" },
  { value: "Z AI", label: "GLM" },
  { value: "Kimi", label: "Kimi" },
  { value: "StepFun", label: "Step" },
  { value: "Alibaba", label: "Qwen" },
];
// 计数口径与相邻的厂商下拉一致：统计当前视图的完整行池，不被搜索 / 开放状态提前裁剪；
// count 为 0 表示该视图没有对应厂商配置，chip 置灰，避免点出空表。
export function vendorChipCounts(rows, chips = VENDOR_CHIPS) {
  const counts = new Map();
  for (const row of rows) {
    const creator = row?.creator;
    if (creator) counts.set(creator, (counts.get(creator) ?? 0) + 1);
  }
  return chips.map((chip) => ({ ...chip, count: counts.get(chip.value) ?? 0 }));
}
export function nativeRanking(
  models,
  source,
  { includeEstimated = false, includeHistorical = false } = {},
) {
  const rows = models
    .flatMap((m) =>
      (m.records[source] ?? []).map((r, i) => ({
        ...r,
        id: `${m.id}:${source}:${i}`,
        modelId: m.id,
        creator: r.creator ?? m.creator,
        openWeights: m.openWeights,
        openConflict: !!m.openConflict,
        configuration: r.configuration ?? r.name,
      })),
    )
    .filter(
      (r) =>
        (includeEstimated || !r.estimated) &&
        (includeHistorical || !r.deprecated),
    );
  rows.sort(
    (a, b) =>
      (Number.isFinite(b.score) ? b.score : -Infinity) -
        (Number.isFinite(a.score) ? a.score : -Infinity) ||
      a.name.localeCompare(b.name),
  );
  let previous = null,
    rank = null;
  return rows.map((r, i) => {
    if (!Number.isFinite(r.score)) return { ...r, rank: null };
    if (previous !== r.score) rank = i + 1;
    previous = r.score;
    return { ...r, rank };
  });
}
export function sanitizeSelection(ids, models) {
  return [...new Set(Array.isArray(ids) ? ids : [])]
    .filter((id) => models.some((m) => m.id === id))
    .slice(0, 4);
}

// 预算约束：按单一来源的真实美元任务成本筛选显示。未披露该来源成本或成本为零的模型无法核对预算，一并隐藏；
// 只影响显示范围，不改变综合分、名次与前沿。综合相对成本是跨源观察，不充当美元预算。
// 行形状锁定为聚合后的模型族（representatives 按来源取成本），禁止回退到顶层 costTask 造成跨源归因。
const budgetCostOf = (row, source) => {
  const cost = row.representatives?.[source]?.costTask;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
};
export function applyBudget(rows, { budgetSource, budgetLimit } = {}) {
  if (
    !budgetSource ||
    budgetSource === "none" ||
    !Number.isFinite(budgetLimit) ||
    budgetLimit <= 0
  )
    return rows;
  return rows.filter((r) => {
    const cost = budgetCostOf(r, budgetSource);
    return cost != null && cost <= budgetLimit;
  });
}
export function budgetSummary(rows, options = {}) {
  const kept = applyBudget(rows, options);
  if (kept.length === rows.length) return null;
  return {
    hidden: rows.length - kept.length,
    missing: rows.filter((r) => budgetCostOf(r, options.budgetSource) == null)
      .length,
  };
}
// LiveBench 分类分是唯一带能力维度的来源；其他榜单没有对应维度，保持缺失。
export function livebenchSuiteKeys(models) {
  const counts = new Map();
  for (const m of models)
    for (const key of Object.keys(m.representatives?.livebench?.suites ?? {}))
      counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key]) => key);
}
export function coverageSummary(models, { includeEstimated = false } = {}) {
  const groups = Array(SOURCE_IDS.length + 1).fill(0);
  const counts = Object.fromEntries(SOURCE_IDS.map((s) => [s, 0]));
  for (const m of models) {
    let count = 0;
    for (const s of SOURCE_IDS) {
      const r = m.representatives[s];
      if (Number.isFinite(r?.score) && (includeEstimated || !r.estimated)) {
        counts[s]++;
        count++;
      }
    }
    groups[count]++;
  }
  return { counts, groups };
}
export function nativeCsvExport(rows, meta = {}) {
  const cell = (v) =>
    '"' +
    (/^[=+\-@\t\r]/.test(String(v ?? "")) ? "'" : "") +
    String(v ?? "").replaceAll('"', '""') +
    '"';
  // 获取时间来自本地可编辑的缓存文件：解析失败留空，不让导出按钮抛异常。
  const fetchedAt = meta.fetchedAt
    ? (() => {
        const t = Date.parse(meta.fetchedAt);
        return Number.isFinite(t) ? new Date(t).toISOString() : "";
      })()
    : "";
  return (
    "\ufeff" +
    [
      [
        "名次",
        "模型配置",
        "厂商",
        "原始总分",
        "每次任务成本 USD",
        "输入单价 USD/百万 token",
        "输出单价 USD/百万 token",
        "估算",
        "历史条目",
        "获取时间",
        "源站版本",
        "投票数",
        "评分区间下限",
        "评分区间上限",
        "发布日期",
      ],
      ...rows.map((r) => [
        r.rank,
        r.configuration,
        r.creator,
        r.score,
        r.costTask,
        r.priceInput,
        r.priceOutput,
        r.estimated ? "是" : "否",
        r.deprecated ? "是" : "否",
        fetchedAt,
        meta.sourceDate ?? "",
        r.voteCount,
        r.scoreLower,
        r.scoreUpper,
        r.publishedAt,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
