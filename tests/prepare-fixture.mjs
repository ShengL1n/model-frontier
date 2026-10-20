import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const output = process.argv[2];
if (!output) {
  console.error("用法：node tests/prepare-fixture.mjs <临时数据目录>");
  process.exit(1);
}
const runtimeData = resolve(
  fileURLToPath(new URL("../data/", import.meta.url)),
);
if (resolve(output) === runtimeData) {
  console.error("不能写入运行时数据目录 data/，请使用临时目录");
  process.exit(1);
}
const fixture = JSON.parse(
  await readFile(new URL("./fixtures/snapshot.json", import.meta.url), "utf8"),
);
// 数据内容固定，缓存时间按运行时刻刷新，避免 E2E 因夹具“过期”而触发质量排除。
const now = new Date().toISOString();
fixture.lastRefresh = now;
fixture.lastFullRefresh = now;
for (const source of Object.values(fixture.sources ?? {})) {
  source.fetchedAt = now;
  source.attemptedAt = now;
  source.stale = false;
  source.error = null;
  delete source.retryDelayMs;
}
await mkdir(output, { recursive: true });
await rm(join(output, "history.json"), { force: true });
await writeFile(
  join(output, "snapshot.json"),
  JSON.stringify(fixture, null, 2),
);
console.log("已准备 E2E 夹具数据：" + output);
