import { SCORE_SOURCES, COST_SOURCES } from "../shared/sources.mjs";
export { COST_SOURCES } from "../shared/sources.mjs";
function percentileFraction(score, pool) {
  if (pool.length === 1) return [50n, 1n];
  const less = pool.filter((v) => v < score).length;
  const equal = pool.filter((v) => v === score).length;
  return [100n * BigInt(2 * less + equal - 1), 2n * BigInt(pool.length - 1)];
}
export function percentile(score, pool) {
  const [numerator, denominator] = percentileFraction(score, pool);
  return Number(numerator) / Number(denominator);
}
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
export function pareto(rows) {
  return rows.filter(
    (r) =>
      !rows.some(
        (o) =>
          o.id !== r.id &&
          o.cost <= r.cost &&
          o.composite >= r.composite &&
          (o.cost < r.cost || o.composite > r.composite),
      ),
  );
}
function median(values) {
  const a = [...values].sort((a, b) => a - b);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
export function combinedCostProfile(
  models,
  includeEstimated = false,
  costSources = COST_SOURCES,
) {
  const eligible =
    costSources.length < 2
      ? []
      : models.filter((m) =>
          costSources.every((s) => {
            const r = m.representatives[s];
            return (
              Number.isFinite(r?.costTask) &&
              r.costTask > 0 &&
              (includeEstimated || !r.estimated)
            );
          }),
        );
  return {
    count: eligible.length,
    sources: costSources,
    medians: Object.fromEntries(
      COST_SOURCES.map((s) => [
        s,
        eligible.length && costSources.includes(s)
          ? median(eligible.map((m) => m.representatives[s].costTask))
          : null,
      ]),
    ),
  };
}
export function combinedCost(
  model,
  profile,
  includeEstimated = false,
  minSources = 3,
) {
  const components = COST_SOURCES.map((source) => {
    const r = model.representatives[source];
    const cost = r?.costTask;
    const baseline = profile.medians[source];
    return {
      source,
      cost,
      baseline,
      ratio: cost > 0 && baseline > 0 ? cost / baseline : null,
      estimated: !!r?.estimated,
    };
  });
  const available = components.filter(
    (c) =>
      Number.isFinite(c.ratio) &&
      c.ratio > 0 &&
      (includeEstimated || !c.estimated),
  );
  if (available.length < minSources)
    return { value: null, components, coverage: available.length };
  return {
    value:
      100 *
      Math.exp(
        available.reduce((sum, c) => sum + Math.log(c.ratio), 0) /
          available.length,
      ),
    components,
    coverage: available.length,
  };
}
// 每榜只比较该榜原始分；同榜同分平票，缺失或被排除估算不参与。
export function majorityMatch(left, right, { includeEstimated = false } = {}) {
  const ballots = SCORE_SOURCES.map((source) => {
    const a = left.representatives[source],
      b = right.representatives[source];
    const valid =
      Number.isFinite(a?.score) &&
      Number.isFinite(b?.score) &&
      (includeEstimated || (!a.estimated && !b.estimated));
    const difference = valid ? a.score - b.score : null;
    return { source, difference, vote: valid ? Math.sign(difference) : null };
  });
  const leftWins = ballots.filter((b) => b.vote === 1).length;
  const rightWins = ballots.filter((b) => b.vote === -1).length;
  const tied = ballots.filter((b) => b.vote === 0).length;
  const sharedSources = ballots.filter((b) => b.vote !== null).length;
  const complete = sharedSources >= 2;
  return {
    ballots,
    leftWins,
    rightWins,
    tied,
    complete,
    sharedSources,
    result: complete ? Math.sign(leftWins - rightWins) : null,
  };
}

function majorityRecords(models, includeEstimated) {
  const records = new Map(
    models.map((m) => [
      m.id,
      {
        wins: 0,
        draws: 0,
        losses: 0,
        opponents: 0,
      },
    ]),
  );
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const result = majorityMatch(models[i], models[j], {
        includeEstimated,
      }).result;
      if (result === null) continue;
      const a = records.get(models[i].id),
        b = records.get(models[j].id);
      a.opponents++;
      b.opponents++;
      if (result === 0) {
        a.draws++;
        b.draws++;
      } else if (result > 0) {
        a.wins++;
        b.losses++;
      } else {
        a.losses++;
        b.wins++;
      }
    }
  }
  return records;
}

export function analyze(
  models,
  {
    costSource = "composite",
    includeEstimated = false,
    costMinSources = 2,
    costSources = COST_SOURCES,
  } = {},
) {
  const profile = combinedCostProfile(models, includeEstimated, costSources);
  const sources = SCORE_SOURCES;
  const required = 2;
  const eligible = models.filter(
    (m) =>
      sources.filter((s) => {
        const r = m.representatives[s];
        return Number.isFinite(r?.score) && (includeEstimated || !r.estimated);
      }).length >= required,
  );
  const matches = majorityRecords(eligible, includeEstimated);
  const pool = Object.fromEntries(
    sources.map((s) => [
      s,
      eligible
        .map((m) => m.representatives[s])
        .filter(
          (r) =>
            Number.isFinite(r?.score) && (includeEstimated || !r.estimated),
        )
        .map((r) => r.score),
    ]),
  );
  const rows = models.map((m) => {
    const available = sources.filter((s) => {
      const r = m.representatives[s];
      return Number.isFinite(r?.score) && (includeEstimated || !r.estimated);
    });
    const covered = sources.length > 0 && available.length >= required;
    const record = matches.get(m.id) ?? null;
    const valid = covered && record.opponents > 0;
    let composite = null;
    const percentiles = {};
    let auxiliary = null;
    if (valid) {
      // 先按有理数精确求和再转数值，避免累加顺序将数学同分拆成不同名次。
      let numerator = 0n,
        denominator = 1n;
      for (const source of available) {
        const [n, d] = percentileFraction(
          m.representatives[source].score,
          pool[source],
        );
        percentiles[source] = Number(n) / Number(d);
        numerator = numerator * d + n * denominator;
        denominator *= d;
      }
      denominator *= BigInt(available.length);
      const divisor = gcd(numerator, denominator);
      auxiliary = Number(numerator / divisor) / Number(denominator / divisor);
      composite = (100 * (record.wins + 0.5 * record.draws)) / record.opponents;
    }
    const costRecord = m.representatives[costSource];
    const combined = combinedCost(m, profile, includeEstimated, costMinSources);
    const cost =
      costSource === "composite" ? combined.value : costRecord?.costTask;
    const reason = !covered
      ? `需要 ${required} 个有效榜单，目前 ${available.length} 个`
      : !valid
        ? `多数对决至少需要 ${required} 榜共同有效的对手，当前没有对手`
        : !Number.isFinite(cost)
          ? costSource === "composite"
            ? `综合成本至少需要 ${costMinSources} 个来源的有效成本`
            : "所选来源未披露任务成本"
          : cost <= 0
            ? "成本为 0 或低于源站精度，未放入对数图"
            : null;
    return {
      ...m,
      composite,
      auxiliary,
      record,
      costCoverage: combined.coverage,
      percentiles,
      available,
      complete: available.length === sources.length,
      cost: Number.isFinite(cost) ? cost : null,
      costUnit: costSource === "composite" ? "相对成本指数" : "USD / task",
      costComponents: combined.components,
      plottable: !reason,
      reason,
      frontier: false,
      openFrontier: false,
    };
  });
  const plotted = rows.filter((r) => r.plottable);
  const front = new Set(pareto(plotted).map((r) => r.id));
  const openFront = new Set(
    pareto(plotted.filter((r) => r.openWeights === true)).map((r) => r.id),
  );
  for (const r of rows) {
    r.frontier = front.has(r.id);
    r.openFrontier = openFront.has(r.id);
  }
  for (const r of rows) {
    r.dominatedBy = !Number.isFinite(r.composite)
      ? []
      : plotted
          .filter(
            (o) =>
              o.frontier &&
              o.id !== r.id &&
              o.cost <= r.cost &&
              o.composite >= r.composite &&
              (o.cost < r.cost || o.composite > r.composite),
          )
          .map((o) => o.name);
  }
  return {
    rows,
    sources,
    required,
    includeEstimated,
    cohort: eligible.length,
    plotted: plotted.length,
    costProfile: profile,
  };
}

const isoTime = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};
export function csvExport(rows, meta = {}) {
  const header = [
    "模型",
    "厂商",
    "开放权重",
    "覆盖榜数",
    "综合分",
    "成本来源数",
    "成本值",
    "成本单位",
    "全球前沿",
    "开放权重前沿",
    "未入图原因",
    "AA",
    "Vals",
    "LiveBench",
    "Arena",
    "AA配置",
    "Vals配置",
    "LiveBench配置",
    "Arena配置",
    "Arena投票数",
    "Arena评分区间下限",
    "Arena评分区间上限",
    "Arena发布日期",
    "数据时间",
    "评分口径",
    "评分公式",
    "胜场",
    "平场",
    "负场",
    "对手数",
    "同积分辅助分",
  ];
  const scope = typeof meta.scope === "string" ? meta.scope : "";
  const dataTime = isoTime(meta.lastRefresh);
  const safe = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      header,
      ...rows.map((r) => [
        r.name,
        r.creator,
        r.openWeights === true
          ? "是"
          : r.openWeights === false
            ? "否"
            : "未确认",
        r.available.length,
        r.composite?.toFixed(4),
        r.costCoverage,
        r.costUnit === "相对成本指数" && r.cost != null ? r.cost / 100 : r.cost,
        r.costUnit === "相对成本指数" ? "基准倍数" : r.costUnit,
        r.frontier ? "是" : "否",
        r.openFrontier ? "是" : "否",
        r.reason,
        ...SCORE_SOURCES.map((s) => r.representatives[s]?.score),
        ...SCORE_SOURCES.map((s) => r.representatives[s]?.configuration),
        r.representatives.arena?.voteCount,
        r.representatives.arena?.scoreLower,
        r.representatives.arena?.scoreUpper,
        r.representatives.arena?.publishedAt,
        dataTime,
        scope,
        "两榜多数对决（同积分辅助排序）",
        r.record?.wins,
        r.record?.draws,
        r.record?.losses,
        r.record?.opponents,
        r.auxiliary?.toFixed(4),
      ]),
    ]
      .map((r) => r.map(safe).join(","))
      .join("\r\n")
  );
}

// Reproduce one source on its own full source population; no common-cohort restriction.
export function sourceAudit(models, modelId, source) {
  const target = models.find((m) => m.id === modelId);
  if (!target) return null;
  const candidates = models
    .flatMap((m) =>
      (m.records[source] ?? [])
        .filter(
          (r) => Number.isFinite(r.score) && !r.estimated && !r.deprecated,
        )
        .map((r, i) => {
          let cost = r.costTask;
          let basis = "每次任务 USD";
          if (source === "livebench") {
            cost = r.costSuccess;
            basis = "每次成功任务 USD";
          }
          return {
            ...r,
            id: m.id + ":" + i,
            modelId: m.id,
            composite: r.score,
            cost,
            basis,
          };
        }),
    )
    .filter((r) => Number.isFinite(r.cost) && r.cost > 0);
  const targets = candidates.filter((r) => r.modelId === modelId);
  const frontIds = new Set(pareto(candidates).map((r) => r.id));
  const preferred = targets.sort((a, b) => b.score - a.score)[0];
  if (!preferred)
    return { source, available: false, reason: "源站缺少有效分数或可用成本" };
  const dominates = candidates
    .filter(
      (o) =>
        o.modelId !== modelId &&
        o.cost <= preferred.cost &&
        o.score >= preferred.score &&
        (o.cost < preferred.cost || o.score > preferred.score),
    )
    .sort((a, b) => b.score - a.score);
  return {
    source,
    available: true,
    name: preferred.name,
    score: preferred.score,
    cost: preferred.cost,
    basis: preferred.basis,
    frontier: frontIds.has(preferred.id),
    anyVariantOnFrontier: targets.some((r) => frontIds.has(r.id)),
    dominatedBy: [...new Set(dominates.map((r) => r.name))].slice(0, 4),
    population: candidates.length,
  };
}
