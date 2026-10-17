import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SOURCE_INFO, FETCHERS } from "./adapters.mjs";
import { aggregate } from "./identity.mjs";
import { createHistoryStore } from "./history.mjs";
export const DATA_DIR =
  process.env.FRONTIER_DATA_DIR ??
  fileURLToPath(new URL("../data/", import.meta.url));
const history = createHistoryStore(DATA_DIR);
let state = {
  schemaVersion: 1,
  sources: {},
  settings: { refreshHours: 6 },
  lastRefresh: null,
};
let running = null;
const activeSources = (sources) =>
  Object.fromEntries(
    Object.entries(sources ?? {}).filter(([id]) =>
      Object.hasOwn(SOURCE_INFO, id),
    ),
  );
export const progress = {
  running: false,
  startedAt: null,
  finishedAt: null,
  sources: {},
};
export async function loadState() {
  try {
    const saved = JSON.parse(
      await readFile(join(DATA_DIR, "snapshot.json"), "utf8"),
    );
    if (saved.schemaVersion === 1) {
      state = { ...saved, sources: activeSources(saved.sources) };
      await persist();
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error("无法读取缓存：", e.message);
  }
  await history.load(activeSources(state.sources));
  return state;
}
let saving = Promise.resolve();
function persist() {
  const serialized = JSON.stringify(state, null, 2);
  saving = saving
    .catch(() => {})
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      const path = join(DATA_DIR, "snapshot.json");
      const temporary = path + ".tmp-" + process.pid;
      await writeFile(temporary, serialized);
      await rename(temporary, path);
    });
  return saving;
}
export function view() {
  return {
    schemaVersion: 1,
    sources: Object.fromEntries(
      Object.entries(SOURCE_INFO).map(([id, info]) => [
        id,
        {
          ...info,
          ...state.sources[id],
          rows: undefined,
          count: state.sources[id]?.rows?.length ?? 0,
        },
      ]),
    ),
    models: aggregate(activeSources(state.sources)),
    settings: state.settings,
    lastRefresh: state.lastRefresh,
    history: history.summary(),
    progress,
  };
}
export async function setRefreshHours(hours) {
  if (![0, 1, 6, 24].includes(hours))
    throw new Error("刷新间隔必须为 0、1、6 或 24 小时");
  state.settings.refreshHours = hours;
  await persist();
  return state.settings;
}
function validScores(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) =>
    Number.isFinite(r.score),
  ).length;
}
// 抓取结果先过闸门再落库：格式合法但条数塌掉的响应（例如源站只下发当前模型、不下发历史
// 配置）不会报错，静默收下会让榜单少掉一大批模型，因此按上次成功缓存比对。
async function refreshSource(id, fetcher) {
  progress.sources[id] = "loading";
  const attemptedAt = new Date().toISOString();
  try {
    const result = await fetcher();
    const valid = validScores(result.rows);
    if (valid < 5)
      throw new Error("源站数据异常：有效模型不足 5 条，拒绝替换缓存");
    const before = validScores(state.sources[id]?.rows);
    if (before >= 200 && valid < before / 2)
      throw new Error(
        `源站数据疑似不完整：有效模型从 ${before} 条降为 ${valid} 条，拒绝替换缓存`,
      );
    state.sources[id] = {
      ...result,
      fetchedAt: new Date().toISOString(),
      attemptedAt,
      error: null,
      stale: false,
    };
    progress.sources[id] = "success";
  } catch (e) {
    state.sources[id] = {
      ...state.sources[id],
      attemptedAt,
      error: e.message,
      stale: true,
    };
    progress.sources[id] = "failed";
  }
}
export function refreshAll(fetchers = FETCHERS) {
  if (running) return running;
  progress.running = true;
  progress.startedAt = new Date().toISOString();
  progress.sources = {};
  running = (async () => {
    await Promise.allSettled(
      Object.entries(fetchers).map(([id, fetcher]) =>
        refreshSource(id, fetcher),
      ),
    );
    state.lastRefresh = new Date().toISOString();
    await persist();
    await history.capture(activeSources(state.sources));
    return view();
  })().finally(() => {
    progress.running = false;
    progress.finishedAt = new Date().toISOString();
    running = null;
  });
  return running;
}
export function refreshDue() {
  const hours = state.settings.refreshHours;
  return (
    hours > 0 &&
    (!state.lastRefresh ||
      Date.now() - Date.parse(state.lastRefresh) > hours * 3600000)
  );
}

export const historyView = (options) => history.view(options);
