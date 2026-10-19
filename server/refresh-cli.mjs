import { loadState, refreshAll } from "./store.mjs";
await loadState();
console.log("正在通过后台 HTTP 从四站刷新…");
const data = await refreshAll();
for (const [id, s] of Object.entries(data.sources))
  console.log(id, s.count, s.error ? `失败，已保留缓存：${s.error}` : "成功");
if (Object.values(data.sources).some((s) => s.stale)) process.exitCode = 1;
