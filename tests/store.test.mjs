import test from "node:test";
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
  assert.deepEqual(Object.keys(data.sources).sort(), [
    "aa",
    "livebench",
    "vals",
  ]);
  assert.equal(data.settings.refreshHours, 1);
  assert.equal(data.models.length, 1);
  assert.equal(data.models[0].name, "Current");
  const saved = JSON.parse(
    await readFile(join(directory, "snapshot.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(saved.sources, "arena"), false);
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
  await rm(directory, { recursive: true, force: true });
});
