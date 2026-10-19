import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "frontier-store-"));
process.env.FRONTIER_DATA_DIR = directory;
const store = await import("../server/store.mjs");
test("legacy cache drops retired sources and preserves hourly refresh", async () => {
  await writeFile(
    join(directory, "snapshot.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: {
        arena: { rows: [{ name: "Retired only", score: 99 }] },
        aa: { rows: [{ name: "Current", score: 10, openWeights: true }] },
      },
      settings: { refreshHours: 1 },
      lastRefresh: null,
    }),
  );
  await store.loadState();
  const data = store.view();
  // 接口总是披露全部来源；旧格式 Arena 不算已获取，count 为 0。
  assert.deepEqual(Object.keys(data.sources).sort(), [
    "aa",
    "arena",
    "livebench",
    "vals",
  ]);
  assert.equal(data.sources.arena.count, 0);
  assert.equal(data.settings.refreshHours, 1);
  assert.equal(data.models.length, 1);
  assert.equal(data.models[0].name, "Current");
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(saved.sources, "arena"), false);
});
test("new-format Arena cache is kept as an acquired source and mixed into models", async () => {
  await writeFile(
    join(directory, "snapshot.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: {
        arena: {
          ingestFormat: "arena-text-overall-v1",
          sourceDate: "2026-10-15",
          fetchedAt: "2026-10-16T02:05:52.769Z",
          rows: [
            {
              name: "Arena Model",
              rawId: "Arena Model",
              score: 1400,
              voteCount: 4904,
              scoreLower: 1500,
              scoreUpper: 1550,
              publishedAt: "2026-10-15",
            },
          ],
        },
        aa: { rows: [{ name: "Current", score: 10, openWeights: true }] },
      },
      settings: { refreshHours: 1 },
      lastRefresh: null,
    }),
  );
  await store.loadState();
  const data = store.view();
  assert.equal(data.sources.arena.count, 1);
  assert.equal(data.sources.arena.sourceDate, "2026-10-15");
  const arenaModel = data.models.find((m) => m.name === "Arena Model");
  assert.ok(arenaModel, "Arena-only 模型应进入模型库");
  assert.equal(arenaModel.representatives.arena.score, 1400);
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(saved.sources.arena.ingestFormat, "arena-text-overall-v1");
});
test("a failed Arena refresh keeps the last good cache and marks it stale", async () => {
  await store.loadState();
  const good = store.view().sources.arena.fetchedAt;
  await store.refreshAll({
    arena: async () => {
      throw new Error("arena outage");
    },
  });
  const data = store.view();
  assert.equal(data.sources.arena.count, 1);
  assert.equal(data.sources.arena.sourceDate, "2026-10-15");
  assert.equal(data.sources.arena.stale, true);
  assert.equal(data.sources.arena.error, "arena outage");
  assert.equal(data.sources.arena.fetchedAt, good);
  assert.ok(data.sources.arena.attemptedAt);
});
test("concurrent refreshes coalesce; failed sources preserve last good snapshot and timestamps", async () => {
  await store.loadState();
  let calls = 0;
  const rows = Array.from({ length: 6 }, (_, i) => ({
    name: "Future " + i,
    score: i,
  }));
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchers = {
    aa: async () => {
      calls++;
      await gate;
      return { rows, sourceDate: "2026-10-16" };
    },
  };
  const first = store.refreshAll(fetchers);
  const second = store.refreshAll(fetchers);
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
  const good = store.view().sources.aa.fetchedAt;
  await store.refreshAll({
    aa: async () => {
      throw new Error("temporary outage");
    },
  });
  const snapshot = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.sources.aa.rows.length, 6);
  assert.equal(snapshot.sources.aa.fetchedAt, good);
  assert.equal(snapshot.sources.aa.stale, true);
  assert.equal(snapshot.sources.aa.error, "temporary outage");
  assert.equal(store.progress.running, false);
});
test("invalid source updates are rejected and automatic refresh may be disabled", async () => {
  await store.refreshAll({ aa: async () => ({ rows: [] }) });
  assert.equal(store.view().sources.aa.count, 6);
  await store.setRefreshHours(0);
  assert.equal(store.refreshDue(), false);
  await assert.rejects(() => store.setRefreshHours(7));
});
test("a suspicious collapse in row count is rejected instead of silently replacing the cache", async () => {
  const rows = Array.from({ length: 240 }, (_, i) => ({
    name: "Model " + i,
    score: i,
  }));
  await store.refreshAll({ aa: async () => ({ rows }) });
  assert.equal(store.view().sources.aa.count, 240);
  // 源站只下发部分数据时格式完全合法，必须按上次成功缓存比对后拒绝
  await store.refreshAll({ aa: async () => ({ rows: rows.slice(0, 100) }) });
  assert.equal(store.view().sources.aa.count, 240);
  assert.match(store.view().sources.aa.error, /疑似不完整/);
  assert.equal(store.view().sources.aa.stale, true);
  // 正常幅度的波动仍然接受
  await store.refreshAll({ aa: async () => ({ rows: rows.slice(0, 200) }) });
  assert.equal(store.view().sources.aa.count, 200);
  assert.equal(store.view().sources.aa.error, null);
  // 小体量来源不受该闸门影响
  await store.refreshAll({ vals: async () => ({ rows: rows.slice(0, 40) }) });
  assert.equal(store.view().sources.vals.count, 40);
  assert.equal(store.view().sources.vals.error, null);
});
after(() => rm(directory, { recursive: true, force: true }));
