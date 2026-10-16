import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHistoryStore,
  diffSnapshots,
  historySnapshot,
} from "../server/history.mjs";
const source = (score = 10, costTask = 1, more = {}) => ({
  aa: {
    fetchedAt: "2026-10-15T00:00:00Z",
    sourceDate: null,
    rows: [
      {
        name: "Test (max)",
        configuration: "Test (max)",
        score,
        costTask,
        ...more,
      },
    ],
  },
});
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "frontier-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, history: createHistoryStore(directory, options) };
}
test("existing cache establishes a real baseline, preserving its original fetch date; restart is idempotent", async (t) => {
  const { directory, history } = await setup(t);
  await history.load(source());
  const first = history.view();
  assert.equal(first.recordCount, 1);
  assert.equal(first.selected.kind, "baseline");
  assert.equal(first.selected.items.length, 0);
  assert.equal(first.selected.sources.aa.fetchedAt, "2026-10-15T00:00:00Z");
  const again = createHistoryStore(directory);
  await again.load(source());
  assert.equal(again.summary().recordCount, 1);
  assert.equal(
    JSON.parse(await readFile(join(directory, "history.json"))).records.length,
    1,
  );
});
test("only semantic row or release changes archive a snapshot; order and refresh metadata do not", async (t) => {
  const { history } = await setup(t);
  const s = source();
  s.aa.rows.push({ name: "Other", score: 20, costTask: 2 });
  await history.load(s);
  const next = structuredClone(s);
  next.aa.rows.reverse();
  next.aa.fetchedAt = "2026-10-16T00:00:00Z";
  next.aa.stale = true;
  next.aa.error = "outage";
  assert.equal(await history.capture(next), false);
  assert.equal(history.summary().recordCount, 1);
  next.aa.sourceDate = "2026-10-16";
  assert.equal(await history.capture(next), true);
  assert.equal(history.view().selected.items.length, 0);
  assert.deepEqual(history.view().selected.sourceChanges, ["aa"]);
});
test("raw score, task cost and token prices retain before and after values without conflating variants", async (t) => {
  const { history } = await setup(t);
  await history.load(source(10, 1, { priceInput: 2 }));
  await history.capture(source(12, 0.5, { priceInput: 3 }));
  const changed = history.view().selected.items[0];
  assert.equal(changed.type, "updated");
  assert.equal(changed.before.score, 10);
  assert.equal(changed.after.costTask, 0.5);
  assert.deepEqual(changed.fields, ["score", "costTask", "priceInput"]);
  assert.equal(changed.modelId, "test");
  const next = source(12, 0.5);
  next.aa.rows[0].configuration = "Test (high)";
  next.aa.rows[0].name = "Test (high)";
  await history.capture(next);
  assert.deepEqual(
    history
      .view()
      .selected.items.map((i) => i.type)
      .sort(),
    ["added", "removed"],
  );
});
test("successful source additions and removals are observable while failures cannot invent removals", async (t) => {
  const { history } = await setup(t);
  const initial = source();
  initial.vals = {
    rows: [{ name: "Other", score: 20 }],
    fetchedAt: "2026-10-15T00:00:00Z",
  };
  await history.load(initial);
  const failed = structuredClone(initial);
  failed.vals.stale = true;
  failed.vals.error = "failure";
  failed.aa.rows.push({ name: "New", score: 40 });
  await history.capture(failed);
  assert.equal(history.view().selected.items.length, 1);
  assert.equal(history.view().selected.items[0].type, "added");
  assert.equal(history.view().selected.items[0].source, "aa");
  const removed = structuredClone(failed);
  removed.aa.rows.shift();
  await history.capture(removed);
  assert.equal(history.view().selected.items[0].type, "removed");
});
test("retention keeps independent snapshots and model-specific raw observations", async (t) => {
  const { history } = await setup(t, { limit: 3 });
  await history.load(source());
  const startedAt = history.summary().startedAt;
  for (let i = 11; i < 16; i++) await history.capture(source(i));
  assert.equal(history.summary().recordCount, 3);
  assert.equal(history.summary().startedAt, startedAt);
  assert.equal(
    history.view({ modelId: "test" }).selected.observations[0].score,
    15,
  );
  assert.equal(
    history.view({ modelId: "absent" }).selected.observations.length,
    0,
  );
  assert.equal(history.view({ recordId: "unknown" }).selected, null);
});
test("corrupted history is retained and clearly reported instead of overwritten", async (t) => {
  const { directory, history } = await setup(t);
  await writeFile(join(directory, "history.json"), "broken data");
  await history.load(source());
  assert.ok(history.summary().error.includes("已保留原文件"));
  assert.equal(
    await readFile(join(directory, "history.json"), "utf8"),
    "broken data",
  );
});
test("archive write failures do not break current cache or advance an unsaved history", async (t) => {
  const { directory, history } = await setup(t);
  await history.load(source());
  await rm(join(directory, "history.json"));
  await mkdir(join(directory, "history.json"));
  assert.equal(await history.capture(source(20)), false);
  assert.equal(history.summary().recordCount, 1);
  assert.ok(history.summary().error.includes("归档失败"));
});
test("snapshots retain per-configuration evidence and ignore unrelated metadata", () => {
  const current = historySnapshot(
    source(10, 1, {
      suites: { reasoning: 30, coding: 20 },
      estimated: true,
      deprecated: true,
    }),
  );
  assert.deepEqual(current.aa.rows[0].suites, { coding: 20, reasoning: 30 });
  assert.equal(current.aa.rows[0].estimated, true);
  assert.equal(diffSnapshots(current, current).length, 0);
});

test("a stable source id cannot join metrics across changed inference settings", () => {
  const before = historySnapshot(source(10, 1, { rawId: "stable-id" }));
  const after = historySnapshot(
    source(20, 2, { rawId: "stable-id", configuration: "Test (high)" }),
  );
  assert.deepEqual(
    diffSnapshots(before, after)
      .map((i) => i.type)
      .sort(),
    ["added", "removed"],
  );
});
test("valid JSON with malformed nested history is preserved without blocking startup", async (t) => {
  const { directory, history } = await setup(t);
  await history.load(source());
  const path = join(directory, "history.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.records[0].sources.aa.rows = { broken: true };
  const malformed = JSON.stringify(saved);
  await writeFile(path, malformed);
  const reloaded = createHistoryStore(directory);
  await assert.doesNotReject(() => reloaded.load(source()));
  assert.ok(reloaded.summary().error.includes("已保留原文件"));
  assert.equal(await readFile(path, "utf8"), malformed);
});
test("rows arrays containing null entries are rejected before diffing, instead of crashing startup", async (t) => {
  const { directory } = await setup(t);
  const history = createHistoryStore(directory);
  await history.load(source());
  const path = join(directory, "history.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.records[0].sources.aa.rows = [null];
  await writeFile(path, JSON.stringify(saved));
  const reloaded = createHistoryStore(directory); // 当前数据与损坏基线不同，确保走 diffSnapshots 路径（修复前在此抛 TypeError）。
  await assert.doesNotReject(() => reloaded.load(source(11)));
  assert.ok(reloaded.summary().error.includes("已保留原文件"));
  assert.equal(await readFile(path, "utf8"), JSON.stringify(saved));
});
