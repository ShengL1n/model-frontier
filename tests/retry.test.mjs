import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "frontier-retry-"));
process.env.FRONTIER_DATA_DIR = directory;
const store = await import("../server/store.mjs");
const minutes = (n) => n * 60 * 1000;
const rows = (prefix) =>
  Array.from({ length: 6 }, (_, i) => ({ name: `${prefix} ${i}`, score: i }));
const healthy = {
  aa: async () => ({ rows: rows("AA") }),
  vals: async () => ({ rows: rows("Vals") }),
};
const snapshot = async () =>
  JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8"));
after(() => rm(directory, { recursive: true, force: true }));
test("failed sources retry alone, back off and never move the full-refresh clock", async () => {
  await store.loadState();
  await store.refreshAll(healthy);
  const initial = await snapshot();
  assert.ok(initial.lastFullRefresh);
  assert.equal(
    store.refreshDue(Date.parse(initial.lastFullRefresh) + minutes(5)),
    false,
  );
  assert.equal(
    store.refreshDue(Date.parse(initial.lastFullRefresh) + 7 * 60 * 60 * 1000),
    true,
  );
  let aaCalls = 0;
  let valsCalls = 0;
  const beforeFailure = store.view().revision;
  await store.refreshAll({
    aa: async () => {
      aaCalls += 1;
      throw new Error("aa outage");
    },
    vals: async () => {
      valsCalls += 1;
      return { rows: rows("Vals") };
    },
  });
  assert.notEqual(store.view().revision, beforeFailure);
  assert.equal(aaCalls, 1);
  assert.equal(valsCalls, 1);
  assert.equal(store.view().sources.aa.stale, true);
  assert.equal(
    store.view().sources.aa.retryDelayMs,
    undefined,
    "内部退避字段不进入页面数据",
  );
  const failed = await snapshot();
  const fullClock = failed.lastFullRefresh;
  assert.equal(store.retryFailed(healthy), null, "未到退避时间不重试");
  let retriedA = 0;
  let retriedVals = 0;
  const retryAA = {
    aa: async () => {
      retriedA += 1;
      throw new Error("still down");
    },
    vals: async () => {
      retriedVals += 1;
      return { rows: rows("Vals") };
    },
  };
  const firstRetry = await store.retryFailed(retryAA, Date.now() + minutes(16));
  assert.ok(firstRetry, "15 分钟后应只重试失败的 aa");
  assert.equal(retriedA, 1);
  assert.equal(retriedVals, 0, "成功来源不参与重试");
  assert.equal(firstRetry.sources.aa.stale, true);
  assert.equal(firstRetry.sources.aa.error, "still down");
  const afterRetry = await snapshot();
  assert.equal(afterRetry.lastFullRefresh, fullClock, "单源重试不推迟全量周期");
  assert.equal(store.retryFailed(retryAA, Date.now() + minutes(20)), null);
  let recovered = 0;
  const recoveredView = await store.retryFailed(
    {
      aa: async () => {
        recovered += 1;
        return { rows: rows("AA") };
      },
      vals: async () => {
        throw new Error("vals 本不应被调用");
      },
    },
    Date.now() + minutes(31),
  );
  assert.ok(recoveredView, "退避翻倍到 30 分钟后重试");
  assert.equal(recovered, 1);
  assert.equal(recoveredView.sources.aa.stale, false);
  assert.equal(recoveredView.sources.aa.error, null);
  assert.equal((await snapshot()).lastFullRefresh, fullClock);
  const revision = store.view().revision;
  await store.setRefreshHours(1);
  const nextRevision = store.statusView().revision;
  assert.notEqual(nextRevision, revision);
  assert.equal(store.view().revision, nextRevision);
});
test("refresh source lists are validated before starting work", async () => {
  assert.throws(() => store.refreshSources([]), /刷新来源不合法/);
  assert.throws(() => store.refreshSources("aa"), /刷新来源不合法/);
  assert.throws(() => store.refreshSources(["aa", "aa"]), /刷新来源不合法/);
  assert.throws(() => store.refreshSources(["nope"]), /刷新来源不合法/);
  await store.setRefreshHours(0);
  assert.equal(store.refreshDue(), false);
  assert.equal(store.retryFailed(healthy, Date.now() + minutes(60)), null);
});
