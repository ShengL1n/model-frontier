import test from "node:test";
import assert from "node:assert/strict";
import { analyze, majorityMatch, csvExport } from "../src/analysis.mjs";
import { rankedModels } from "../src/portal.mjs";
import { applyEvidencePolicy } from "../src/evidence.mjs";
const model = (id, scores) => ({
  id,
  name: id,
  openWeights: true,
  representatives: Object.fromEntries(
    ["aa", "vals", "livebench"].flatMap((s, i) =>
      scores[i] == null ? [] : [[s, { score: scores[i], costTask: 1 }]],
    ),
  ),
});
const run = (models, options = {}) => analyze(models, options);

test("two of three ballots win irrespective of score margins", () => {
  const a = model("a", [51, 51, 0]),
    b = model("b", [50, 50, 100]);
  const match = majorityMatch(a, b);
  assert.equal(match.result, 1);
  assert.deepEqual([match.leftWins, match.rightWins, match.tied], [2, 1, 0]);
  assert.equal(match.ballots[2].difference, -100);
  const result = analyze([a, b]);
  assert.equal(result.required, 2);
  assert.equal(result.rows[0].composite, 100);
  assert.equal(result.rows[1].composite, 0);
  assert.deepEqual(result.rows[0].record, {
    wins: 1,
    draws: 0,
    losses: 0,
    opponents: 1,
  });
});

test("majority cycles produce tied scores with deterministic competition ranks", () => {
  const models = [
    model("a", [3, 1, 2]),
    model("b", [2, 3, 1]),
    model("c", [1, 2, 3]),
  ];
  const result = run(models);
  for (const r of result.rows) {
    assert.equal(r.composite, 50);
    assert.deepEqual(r.record, { wins: 1, draws: 0, losses: 1, opponents: 2 });
  }
  assert.deepEqual(
    rankedModels(result.rows).map((r) => r.rank),
    [1, 1, 1],
  );
  assert.deepEqual(
    run([...models].reverse()).rows.map((r) => r.composite),
    [50, 50, 50],
  );
});

test("tied ballots and tied contests count half a match, never raw-score tiebreaks", () => {
  const a = model("a", [1, 10, 5]),
    b = model("b", [2, 9, 5]);
  assert.equal(majorityMatch(a, b).result, 0);
  for (const r of run([a, b]).rows) {
    assert.equal(r.composite, 50);
    assert.deepEqual(r.record, { wins: 0, draws: 1, losses: 0, opponents: 1 });
  }
  assert.equal(majorityMatch(a, model("c", [1, 10, 4])).result, 1);
  assert.equal(majorityMatch(a, a).tied, 3);
});

test("missing scores and disallowed estimates never enter the formal cohort", () => {
  const a = model("a", [3, 3, 3]),
    b = model("b", [2, 2, 2]),
    partial = model("partial", [100]);
  const estimate = model("estimate", [4, 4, 4]);
  estimate.representatives.aa.estimated = true;
  estimate.representatives.vals.estimated = true;
  const result = run([a, b, partial, estimate]);
  assert.equal(result.cohort, 2);
  for (const r of result.rows.slice(2)) {
    assert.equal(r.composite, null);
    assert.equal(r.record, null);
    assert.equal(r.plottable, false);
    assert.equal(r.frontier, false);
  }
  assert.equal(majorityMatch(a, partial).result, null);
  assert.equal(majorityMatch(a, estimate).result, null);
  assert.equal(
    majorityMatch(a, estimate, { includeEstimated: true }).result,
    -1,
  );
  assert.equal(
    run([a, b, partial, estimate], { includeEstimated: true }).cohort,
    3,
  );
  const withRecords = [a, b].map((m) => ({
    ...m,
    records: Object.fromEntries(
      Object.entries(m.representatives).map(([s, r]) => [s, [r]]),
    ),
  }));
  const removed = applyEvidencePolicy(
    withRecords,
    { vals: { stale: true } },
    { excludeStale: true },
  );
  assert.equal(run(removed).cohort, 2);
});

test("zero or one eligible model never gets an invented neutral score", () => {
  assert.equal(run([]).cohort, 0);
  const a = run([model("a", [1, 1, 1]), model("b", [2, null])]);
  assert.equal(a.rows[0].composite, null);
  assert.match(a.rows[0].reason, /没有对手/);
  assert.equal(a.rows[0].record.opponents, 0);
  assert.equal(rankedModels(a.rows)[0].rank, null);
});

test("costs do not change ballots, ranks or opponents; exports include exact results", () => {
  const models = [
    model("a", [3, 3, 3]),
    model("b", [2, 2, 2]),
    model("c", [1, 1, 1]),
  ];
  models[1].representatives.aa.costTask = null;
  const a = run(models),
    b = run(models, { costSource: "aa" });
  assert.deepEqual(
    a.rows.map((r) => r.composite),
    b.rows.map((r) => r.composite),
  );
  assert.equal(b.rows[1].plottable, false);
  assert.deepEqual(
    a.rows.map((r) => r.record.opponents),
    [2, 2, 2],
  );
  assert.deepEqual(
    rankedModels(a.rows)
      .filter((r) => r.id === "b")
      .map((r) => r.rank),
    [2],
  );
  const csv = csvExport(a.rows, { scope: "多数对决 v1" });
  assert.match(csv, /评分公式/);
  assert.match(csv, /对手数/);
  assert.match(csv, /两榜多数对决/);
});

test("two-source rule admits two-source models but never counts a one-source overlap", () => {
  const rows = [
    model("a", [3, 3, 3]),
    model("b", [2, 2]),
    model("c", [null, 1, 1]),
  ];
  const result = run(rows, {});
  assert.equal(result.required, 2);
  assert.equal(result.cohort, 3);
  assert.deepEqual(
    result.rows.map((r) => r.record.opponents),
    [2, 1, 1],
  );
  assert.deepEqual(
    result.rows.map((r) => r.composite),
    [100, 0, 0],
  );
  assert.equal(majorityMatch(rows[1], rows[2]).result, null);
  assert.equal(majorityMatch(rows[0], rows[1]).result, 1);
  assert.deepEqual(
    rankedModels(result.rows).map((r) => [r.id, r.rank]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ],
  );
  assert.equal(run(rows.slice(1), {}).rows[0].composite, null);
});

test("auxiliary tiebreak sorts final standings without altering matches or Pareto membership", () => {
  const models = [
    model("a", [4, 1, 3]),
    model("b", [3, 4, 1]),
    model("c", [1, 3, 4]),
    model("d", [0, 2, 2]),
  ];
  const result = run(models, {});
  assert.equal(result.rows[0].composite, result.rows[2].composite);
  assert.ok(result.rows[2].auxiliary > result.rows[0].auxiliary);
  assert.deepEqual(
    rankedModels(result.rows).map((r) => [r.id, r.rank]),
    [
      ["c", 1],
      ["a", 2],
      ["b", 2],
      ["d", 4],
    ],
  );
  for (const r of result.rows.slice(0, 3))
    assert.equal(
      r.frontier,
      true,
      "辅助分不应参与相同主积分与相同成本下的支配判定",
    );
  assert.equal(majorityMatch(models[0], models[2]).result, -1);
  const two = [model("a", [4, 2]), model("b", [3, 3])];
  const tied = run(two, {});
  assert.deepEqual(
    tied.rows.map((r) => r.record.draws),
    [1, 1],
  );
  assert.deepEqual(
    tied.rows.map((r) => r.composite),
    [50, 50],
  );
});

test("mathematically equal auxiliary averages remain tied across summation orders", () => {
  const scores = [
    [6, 5, 2],
    [2, 4, 4],
    [7, 6, 1],
    [5, 1, 3],
    [3, 7, 6],
    [4, 2, 7],
    [1, 3, 5],
  ];
  const rows = run(scores.map((scores, i) => model(String(i), scores))).rows;
  assert.equal(rows[0].composite, rows[5].composite);
  assert.equal(
    rows[0].auxiliary,
    rows[5].auxiliary,
    "两个模型排名分的精确平均均为 500/9，不应被浮点加法次序拆成不同名次",
  );
  const ranks = rankedModels(rows);
  assert.equal(
    ranks.find((r) => r.id === "0").rank,
    ranks.find((r) => r.id === "5").rank,
  );
});
