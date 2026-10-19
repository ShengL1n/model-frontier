import test from "node:test";
import assert from "node:assert/strict";
import {
  percentile,
  pareto,
  analyze,
  csvExport,
  combinedCostProfile,
  combinedCost,
  sourceAudit,
} from "../src/analysis.mjs";
import { familyKey, aggregate } from "../server/identity.mjs";
const model = (id, records, openWeights = true) => ({
  id,
  name: id,
  creator: "test",
  openWeights,
  records: Object.fromEntries(
    Object.entries(records).map(([k, v]) => [k, [v]]),
  ),
  representatives: records,
});
test("average ranks handle ties; one-model pool is neutral", () => {
  assert.equal(percentile(5, [1, 5, 5, 9]), 50);
  assert.equal(percentile(1, [1, 5, 5, 9]), 0);
  assert.equal(percentile(9, [1, 5, 5, 9]), 100);
  assert.equal(percentile(7, [7]), 50);
});
test("Pareto retains ties, rejects equal-score expensive choices", () => {
  const rows = [
    { id: "a", cost: 1, composite: 50 },
    { id: "b", cost: 2, composite: 50 },
    { id: "c", cost: 3, composite: 80 },
    { id: "d", cost: 1, composite: 50 },
  ];
  assert.deepEqual(
    pareto(rows).map((r) => r.id),
    ["a", "c", "d"],
  );
});
test("missing-source models remain visible but cannot silently enter strict frontier", () => {
  const r = analyze(
    [
      model("a", { aa: { score: 10, costTask: 1 }, livebench: { score: 50 } }),
      model("b", { aa: { score: 20, costTask: 0.5 } }),
      model("c", { aa: { score: 5, costTask: 1 }, livebench: { score: 40 } }),
    ],
    { costSource: "aa" },
  );
  assert.equal(r.rows[1].composite, null);
  assert.equal(r.rows[1].plottable, false);
  assert.equal(r.rows[0].frontier, true);
});
test("cost origin changes frontier without changing scores", () => {
  const m = [
    model("a", {
      aa: { score: 10, costTask: 1 },
      vals: { score: 10, costTask: 5 },
    }),
    model("b", {
      aa: { score: 20, costTask: 2 },
      vals: { score: 20, costTask: 1 },
    }),
  ];
  const a = analyze(m, { costSource: "aa" });
  const v = analyze(m, { costSource: "vals" });
  assert.deepEqual(
    a.rows.map((r) => r.composite),
    v.rows.map((r) => r.composite),
  );
  assert.equal(a.rows[0].frontier, true);
  assert.equal(v.rows[0].frontier, false);
});
test("zero and missing costs never appear on logarithmic chart", () => {
  for (const cost of [0, null, undefined]) {
    const r = analyze(
      [
        model("a", { aa: { score: 10, costTask: cost }, vals: { score: 10 } }),
        model("b", { aa: { score: 20, costTask: 1 }, vals: { score: 20 } }),
      ],
      { costSource: "aa" },
    );
    assert.equal(r.rows[0].plottable, false);
  }
});
test("open frontier is separately computed against open models", () => {
  const r = analyze(
    [
      model(
        "open",
        { aa: { score: 10, costTask: 1 }, vals: { score: 10 } },
        true,
      ),
      model(
        "closed",
        { aa: { score: 20, costTask: 0.5 }, vals: { score: 20 } },
        false,
      ),
    ],
    { costSource: "aa" },
  );
  assert.equal(r.rows[0].frontier, false);
  assert.equal(r.rows[0].openFrontier, true);
});
test("name grammar joins inference effort but preserves releases and dates", () => {
  assert.equal(
    familyKey("Claude Opus 5.5 (max with fallback)"),
    familyKey("claude-opus-5.5-high"),
  );
  assert.equal(familyKey("GLM-5.3 (max)"), familyKey("glm-5.3-max"));
  assert.notEqual(
    familyKey("Mistral Large 4 Preview"),
    familyKey("Mistral Large 4"),
  );
  assert.notEqual(
    familyKey("DeepSeek V4 Flash Vision"),
    familyKey("DeepSeek V4 Flash 0731"),
  );
  assert.notEqual(
    familyKey("Claude Opus 4.5 20251101"),
    familyKey("Claude Opus 4.5"),
  );
  assert.equal(familyKey("Muse Wonder 1.0"), familyKey("Wonder"));
});
test("new families are discovered without a model whitelist; conflicts stay unconfirmed", () => {
  const g = aggregate({
    aa: { rows: [{ name: "NewModel 99", score: 20, openWeights: true }] },
    livebench: {
      rows: [{ name: "newmodel-99-high", score: 100, openWeights: false }],
    },
  });
  assert.equal(g.length, 1);
  assert.equal(g[0].coverage, 2);
  assert.equal(g[0].openWeights, null);
  assert.equal(g[0].openConflict, true);
});
test("an Arena-only model joins the library with its own evidence as fallback", () => {
  const g = aggregate({
    arena: {
      ingestFormat: "arena-text-overall-v1",
      rows: [
        {
          name: "Arena Only 1",
          rawId: "Arena Only 1",
          score: 1400,
          openWeights: false,
          creator: "Mystery Lab",
        },
      ],
    },
  });
  assert.equal(g.length, 1);
  assert.equal(g[0].representatives.arena.score, 1400);
  // 无 AA / LiveBench / Vals 记录时，Arena 记录兜底模型名与厂商
  assert.equal(g[0].name, "Arena Only 1");
  assert.equal(g[0].creator, "Mystery Lab");
});
test("representative cost stays bound to the chosen variant and estimates are secondary", () => {
  const g = aggregate({
    aa: {
      rows: [
        { name: "New 1 (low)", score: 20, costTask: 1, estimated: false },
        { name: "New 1 (max)", score: 40, costTask: 100, estimated: true },
      ],
    },
  });
  assert.equal(g[0].representatives.aa.score, 20);
  assert.equal(g[0].representatives.aa.costTask, 1);
});
test("CSV export neutralizes spreadsheet formula injection", () => {
  const csv = csvExport([
    {
      name: '=HYPERLINK("bad")',
      creator: "x",
      available: [],
      representatives: {},
    },
  ]);
  assert.ok(csv.includes("'=HYPERLINK"));
});
test("dominator explanation is independent of alphabetical iteration order", () => {
  const r = analyze(
    [
      model("a", { aa: { score: 10, costTask: 2 }, vals: { score: 10 } }),
      model("z", { aa: { score: 20, costTask: 1 }, vals: { score: 20 } }),
    ],
    { costSource: "aa" },
  );
  assert.deepEqual(r.rows[0].dominatedBy, ["z"]);
});

test("combined cost is normalized geometric mean, not arithmetic USD average", () => {
  const models = [
    model("a", {
      aa: { costTask: 1 },
      vals: { costTask: 10 },
      livebench: { costTask: 100 },
    }),
    model("b", {
      aa: { costTask: 2 },
      vals: { costTask: 20 },
      livebench: { costTask: 200 },
    }),
  ];
  const p = combinedCostProfile(models);
  assert.deepEqual(p.medians, { aa: 1.5, vals: 15, livebench: 150 });
  assert.ok(Math.abs(combinedCost(models[0], p).value - (100 * 2) / 3) < 1e-8);
  assert.ok(Math.abs(combinedCost(models[1], p).value - (100 * 4) / 3) < 1e-8);
});
test("changing a source currency scale does not change combined relative costs", () => {
  const a = [
    model("a", {
      aa: { costTask: 1 },
      vals: { costTask: 20 },
      livebench: { costTask: 3 },
    }),
    model("b", {
      aa: { costTask: 2 },
      vals: { costTask: 10 },
      livebench: { costTask: 4 },
    }),
  ];
  const b = structuredClone(a);
  for (const m of b) m.representatives.vals.costTask *= 1000;
  const pa = combinedCostProfile(a),
    pb = combinedCostProfile(b);
  assert.ok(
    Math.abs(combinedCost(a[0], pa).value - combinedCost(b[0], pb).value) <
      1e-9,
  );
});
test("missing-source costs are not imputed or reweighted into combined cost", () => {
  const a = [
    model("a", {
      aa: { score: 1, costTask: 1 },
      vals: { score: 1, costTask: 2 },
      livebench: { score: 1, costTask: 3 },
    }),
    model("b", {
      aa: { score: 2, costTask: 1 },
      vals: { score: 2, costTask: 2 },
    }),
  ];
  const r = analyze(a, { costSource: "composite", costMinSources: 3 });
  assert.equal(r.costProfile.count, 1);
  assert.equal(r.rows[0].cost, 100);
  assert.equal(r.rows[1].cost, null);
  assert.equal(r.rows[1].plottable, false);
});

test("Arena never enters the combined cost baseline, per-model cost or composite ballots", () => {
  const base = [
    model("a", {
      aa: { score: 9, costTask: 1 },
      vals: { score: 9, costTask: 10 },
      livebench: { score: 9, costTask: 100 },
    }),
    model("b", {
      aa: { score: 5, costTask: 2 },
      vals: { score: 5, costTask: 20 },
      livebench: { score: 5, costTask: 200 },
    }),
  ];
  const withArena = structuredClone(base);
  // 即使脏数据给 Arena 塞了成本，成本基准与几何平均也必须无视它
  withArena[0].representatives.arena = {
    score: 1400,
    costTask: 0.0001,
    voteCount: 4904,
  };
  withArena[1].representatives.arena = { score: 900, costTask: 999 };
  const pb = combinedCostProfile(base);
  const pa = combinedCostProfile(withArena);
  assert.deepEqual(pa.medians, pb.medians);
  assert.equal(pa.sources.includes("arena"), false);
  assert.equal(pa.count, pb.count);
  for (let i = 0; i < 2; i++)
    assert.ok(
      Math.abs(
        combinedCost(base[i], pb).value - combinedCost(withArena[i], pa).value,
      ) < 1e-9,
    );
  const rb = analyze(base),
    ra = analyze(withArena);
  assert.deepEqual(
    ra.rows.map((r) => [r.composite, r.cost, r.coverage]),
    rb.rows.map((r) => [r.composite, r.cost, r.coverage]),
  );
});

test("composite CSV carries Arena raw score, votes, interval and publish date", () => {
  const rows = analyze([
    model("a", {
      aa: { score: 9, costTask: 1 },
      vals: { score: 9, costTask: 1 },
      livebench: { score: 9, costTask: 1 },
      arena: {
        score: 1532.34,
        voteCount: 4904,
        scoreLower: 1500,
        scoreUpper: 1560,
        publishedAt: "2026-10-15",
      },
    }),
  ]).rows;
  const csv = csvExport(rows);
  for (const header of [
    "Arena",
    "Arena配置",
    "Arena投票数",
    "Arena评分区间下限",
    "Arena评分区间上限",
    "Arena发布日期",
  ])
    assert.ok(csv.includes(header), `缺少列 ${header}`);
  assert.ok(csv.includes("1532.34"));
  assert.ok(csv.includes("4904"));
  assert.ok(csv.includes("2026-10-15"));
});

test("source audit restores native source population rather than the shared-source intersection", () => {
  const a = model("a", {
    vals: { name: "A", score: 50, costTask: 2 },
    aa: { score: 1, costTask: 1 },
  });
  const b = model("b", { vals: { name: "B", score: 60, costTask: 1 } });
  const r = sourceAudit([a, b], "a", "vals");
  assert.equal(r.frontier, false);
  assert.deepEqual(r.dominatedBy, ["B"]);
  assert.equal(r.population, 2);
});

test("default two-source cost allows a partial geometric mean but marks its coverage", () => {
  const m = [
    model("full", {
      aa: { score: 10, costTask: 2 },
      vals: { score: 10, costTask: 8 },
      livebench: { score: 10, costTask: 32 },
    }),
    model("two", {
      aa: { score: 20, costTask: 1 },
      vals: { score: 20, costTask: 4 },
    }),
  ];
  const r = analyze(m);
  assert.equal(r.rows[1].costCoverage, 2);
  assert.ok(Math.abs(r.rows[1].cost - 50) < 1e-8);
  assert.equal(r.rows[1].plottable, true);
  assert.equal(r.rows[1].complete, false);
});
test("extra source mentions cannot raise an objectively lowest scoring model", () => {
  const full = (score) => ({
    aa: { score, costTask: 1 },
    vals: { score, costTask: 1 },
    livebench: { score, costTask: 1 },
  });
  const models = [
    model("lowest", full(10)),
    model("partial", {
      aa: { score: 20, costTask: 1 },
      vals: { score: 20, costTask: 1 },
    }),
    model("highest", full(30)),
  ];
  const result = analyze(models, { costSource: "aa" });
  assert.deepEqual(
    result.rows.map((r) => r.composite),
    [0, 50, 100],
  );
  assert.equal(Object.hasOwn(result.rows[0], "coverageBonus"), false);
});

test("csv export attaches data time and scoring scope for later review", () => {
  const csv = csvExport(
    [{ name: "a", creator: "x", available: [], representatives: {} }],
    {
      lastRefresh: "2026-10-16T02:05:53.568Z",
      scope: "两榜多数对决 · 至少 2 榜",
    },
  );
  assert.ok(csv.includes("数据时间"));
  assert.ok(csv.includes("2026-10-16T02:05:53.568Z"));
  assert.ok(csv.includes("评分口径"));
  assert.ok(csv.includes("两榜多数对决 · 至少 2 榜"));
});
test("csv export leaves the data time empty instead of throwing on a corrupted timestamp", () => {
  const csv = csvExport(
    [{ name: "a", creator: "x", available: [], representatives: {} }],
    { lastRefresh: "not-a-date" },
  );
  assert.ok(csv.includes("数据时间"));
  assert.ok(!csv.includes("Invalid"));
});
