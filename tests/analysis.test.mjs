import test from "node:test";
import assert from "node:assert/strict";
import {
  percentile,
  pareto,
  analyze,
  csvExport,
  combinedCostProfile,
  combinedCost,
  frontierStability,
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
    ],
    { aa: 50, livebench: 50 },
    { minSources: 2, costSource: "aa" },
  );
  assert.equal(r.rows[1].composite, null);
  assert.equal(r.rows[1].plottable, false);
  assert.equal(r.rows[0].frontier, true);
});
test("exploration weights renormalize and are marked incomplete", () => {
  const m = [
    model("a", { aa: { score: 10, costTask: 1 }, livebench: { score: 50 } }),
    model("b", { aa: { score: 20, costTask: 0.5 } }),
  ];
  const r = analyze(
    m,
    { aa: 80, livebench: 20 },
    { minSources: 1, costSource: "aa" },
  );
  assert.equal(r.rows[1].composite, 100);
  assert.equal(r.rows[1].complete, false);
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
  const a = analyze(
    m,
    { aa: 50, vals: 50 },
    { minSources: 2, costSource: "aa" },
  );
  const v = analyze(
    m,
    { aa: 50, vals: 50 },
    { minSources: 2, costSource: "vals" },
  );
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
      [model("a", { aa: { score: 10, costTask: cost } })],
      { aa: 100 },
      { minSources: 1, costSource: "aa" },
    );
    assert.equal(r.rows[0].plottable, false);
  }
});
test("open frontier is separately computed against open models", () => {
  const r = analyze(
    [
      model("open", { aa: { score: 10, costTask: 1 } }, true),
      model("closed", { aa: { score: 20, costTask: 0.5 } }, false),
    ],
    { aa: 100 },
    { minSources: 1, costSource: "aa" },
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
      model("a", { aa: { score: 10, costTask: 2 } }),
      model("z", { aa: { score: 20, costTask: 1 } }),
    ],
    { aa: 100 },
    { minSources: 1, costSource: "aa" },
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
  const r = analyze(
    a,
    { aa: 100 },
    { minSources: 1, costSource: "composite", costMinSources: 3 },
  );
  assert.equal(r.costProfile.count, 1);
  assert.equal(r.rows[0].cost, 100);
  assert.equal(r.rows[1].cost, null);
  assert.equal(r.rows[1].plottable, false);
});

test("frontier stability uses identical complete cohort and reports a 12-scenario frequency", () => {
  const a = [
    model("a", {
      aa: { score: 10, costTask: 1 },
      vals: { score: 10, costTask: 1 },
      livebench: { score: 10, costTask: 1 },
    }),
    model("b", {
      aa: { score: 20, costTask: 2 },
      vals: { score: 20, costTask: 2 },
      livebench: { score: 20, costTask: 2 },
    }),
    model("missing", { aa: { score: 100, costTask: 0.001 } }),
  ];
  const r = frontierStability(a);
  assert.equal(r.cohort, 2);
  assert.equal(r.rows.length, 2);
  assert.equal(r.scenarioCount, 12);
  assert.ok(
    r.rows.every(
      (r) =>
        r.globalIndex === 100 &&
        r.openIndex === 100 &&
        r.scenarios.length === 12,
    ),
  );
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
  const r = analyze(m, { aa: 50, vals: 50 });
  assert.equal(r.rows[1].costCoverage, 2);
  assert.ok(Math.abs(r.rows[1].cost - 50) < 1e-8);
  assert.equal(r.rows[1].plottable, true);
  assert.equal(r.rows[1].complete, true);
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
  const result = analyze(
    models,
    { aa: 40, vals: 35, livebench: 25 },
    { minSources: 2, costSource: "aa" },
  );
  assert.deepEqual(
    result.rows.map((r) => r.composite),
    [0, 50, 100],
  );
  assert.equal(Object.hasOwn(result.rows[0], "coverageBonus"), false);
});

test("retired source preferences migrate without changing the remaining custom settings", async () => {
  const { migratePreferences, PRESETS } = await import("../src/analysis.mjs");
  const legacy = {
    preset: "capability",
    weights: { arena: 10, aa: 35, vals: 30, livebench: 25 },
    minSources: 4,
    focus: "openOnly",
    costSource: "vals",
  };
  const migrated = migratePreferences(legacy);
  assert.deepEqual(migrated.weights, PRESETS.capability.weights);
  assert.equal(migrated.minSources, 3);
  assert.equal(migrated.focus, "openOnly");
  assert.equal(migrated.costSource, "vals");
  assert.deepEqual(
    migratePreferences({
      ...legacy,
      preset: "custom",
      weights: { arena: 90, aa: 5, vals: 5 },
    }).weights,
    { aa: 5, vals: 5, livebench: 0 },
  );
  assert.deepEqual(
    migratePreferences({ preset: "custom", weights: { arena: 100 } }).weights,
    PRESETS.capability.weights,
  );
});

import { scopeComparison } from "../src/analysis.mjs";
test("csv export attaches data time and scoring scope for later review", () => {
  const csv = csvExport(
    [{ name: "a", creator: "x", available: [], representatives: {} }],
    { lastRefresh: "2026-10-16T02:05:53.568Z", scope: "能力优先 · 至少 2 榜" },
  );
  assert.ok(csv.includes("数据时间"));
  assert.ok(csv.includes("2026-10-16T02:05:53.568Z"));
  assert.ok(csv.includes("评分口径"));
  assert.ok(csv.includes("能力优先 · 至少 2 榜"));
});
test("csv export leaves the data time empty instead of throwing on a corrupted timestamp", () => {
  const csv = csvExport(
    [{ name: "a", creator: "x", available: [], representatives: {} }],
    { lastRefresh: "not-a-date" },
  );
  assert.ok(csv.includes("数据时间"));
  assert.ok(!csv.includes("Invalid"));
});
test("scope comparison contrasts strict all-source ranking with exploration threshold", () => {
  const full = (aa, vals, lb, cost) => ({
    aa: { score: aa, costTask: cost },
    vals: { score: vals, costTask: cost },
    livebench: { score: lb, costTask: cost },
  });
  const models = [
    model("top", full(100, 100, 100, 5)),
    model("mid", full(85, 85, 10, 1)),
    model("partial", {
      aa: { score: 90, costTask: 0.5 },
      vals: { score: 90, costTask: 0.5 },
    }),
  ];
  const r = scopeComparison(
    models,
    { aa: 40, vals: 35, livebench: 25 },
    { minSources: 2, costSource: "aa" },
  );
  assert.equal(r.strictMin, 3);
  assert.equal(r.exploreMin, 2);
  assert.equal(r.strictCohort, 2);
  assert.equal(r.exploreCohort, 3);
  assert.deepEqual(
    r.onlyExploration.map((x) => x.name),
    ["partial"],
  );
  assert.deepEqual(
    r.shifts.map((x) => [x.name, x.strictRank, x.exploreRank]),
    [["mid", 2, 3]],
  );
  assert.deepEqual(
    r.frontierChanges.map((x) => [x.name, x.strict, x.explore]).sort(),
    [
      ["mid", "全球前沿", "未入前沿"],
      ["partial", "未入前沿", "全球前沿"],
    ],
  );
});
test("strict views still contrast the loosest exploration; single source has no scope split", () => {
  const models = [model("a", { aa: { score: 10, costTask: 1 } })];
  assert.equal(
    scopeComparison(models, { aa: 100 }, { minSources: 1, costSource: "aa" }),
    null,
  );
  const pair = [
    model("a", {
      aa: { score: 10, costTask: 1 },
      vals: { score: 10, costTask: 1 },
    }),
    model("b", {
      aa: { score: 20, costTask: 1 },
      vals: { score: 20, costTask: 1 },
    }),
  ];
  const r = scopeComparison(
    pair,
    { aa: 50, vals: 50 },
    { minSources: 2, costSource: "aa" },
  );
  assert.equal(r.strictMin, 2);
  assert.equal(r.exploreMin, 1);
  assert.equal(r.shiftCount, 0);
  assert.deepEqual(r.frontierChanges, []);
});
test("scope comparison gives tied composites the same rank and never reports undefined positions", () => {
  const full = (aa, vals, lb, cost) => ({
    aa: { score: aa, costTask: cost },
    vals: { score: vals, costTask: cost },
    livebench: { score: lb, costTask: cost },
  });
  const models = [
    model("top", full(100, 100, 100, 5)),
    model("tie1", full(50, 50, 50, 2)),
    model("tie2", full(50, 50, 50, 3)),
    model("partial", {
      aa: { score: 60, costTask: 0.5 },
      vals: { score: 60, costTask: 0.5 },
    }),
  ];
  const r = scopeComparison(
    models,
    { aa: 40, vals: 35, livebench: 25 },
    { minSources: 2, costSource: "aa" },
  );
  assert.deepEqual(
    r.onlyExploration.map((x) => x.name),
    ["partial"],
  );
  assert.ok(
    r.shifts.every(
      (x) => Number.isFinite(x.strictRank) && Number.isFinite(x.exploreRank),
    ),
  );
  assert.deepEqual(
    r.shifts.map((x) => [x.name, x.strictRank, x.exploreRank]).sort(),
    [
      ["tie1", 2, 3],
      ["tie2", 2, 3],
    ],
  );
});
