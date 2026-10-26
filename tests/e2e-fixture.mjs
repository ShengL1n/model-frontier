// 在确定性夹具上跑三套 E2E：与 CI 同一条数据路径，不访问源站、不受实时数据漂移影响。
// 用法：npm run test:e2e:fixture
// 单独起服务占用 4318，避免撞到本机 4317 的开发服务。
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4318;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = await mkdtemp(join(tmpdir(), "frontier-e2e-"));

const run = (command, args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });

const ready = async () => {
  // 60 次 × 500ms = 30 秒；单次请求也设超时，避免端口被非 HTTP 服务占用时永久挂死
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${base}/api/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return true;
    } catch {
      // 服务尚未监听
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

const step = async (command, args, env, label) => {
  const code = await run(command, args, env);
  if (code !== 0) throw new Error(`${label} 退出码 ${code}`);
};

let server;
let serverExited;
try {
  await step(
    "node",
    ["tests/prepare-fixture.mjs", dataDir],
    {},
    "准备夹具数据",
  );
  server = spawn("node", ["server/index.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(PORT),
      FRONTIER_DATA_DIR: dataDir,
      FRONTIER_AUTO_REFRESH: "0",
    },
  });
  //  spawn 后立刻挂监听：等服务已退出再挂只会永久挂住
  serverExited = new Promise((resolve) => server.once("exit", resolve));
  if (!(await ready())) throw new Error(`服务 ${base} 30 秒内未就绪`);
  for (const suite of ["test:e2e", "test:portal", "test:evidence"]) {
    const code = await run("npm", ["run", suite], { FRONTIER_URL: base });
    if (code !== 0) {
      console.error(`E2E 失败：${suite}`);
      process.exitCode = code;
      break;
    }
  }
} finally {
  if (server) {
    // 等子进程真正退出再删数据目录，避免它退出途中又把目录写回来
    server.kill("SIGTERM");
    await serverExited;
  }
  await rm(dataDir, { recursive: true, force: true });
}
