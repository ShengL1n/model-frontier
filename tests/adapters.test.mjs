import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  SOURCE_INFO,
  FETCHERS,
  aaManifest,
  decryptAAGzip,
  parseAA,
  parseVals,
  parseLivebench,
} from "../server/adapters.mjs";

// AA 的全量数据是 AES-256-GCM 加密后 gzip 的 JSON，IV 取 SHA-256(key) 前 12 字节。
const KEY = "aa".repeat(32);
const dataIv = (keyHex) =>
  createHash("sha256")
    .update(Buffer.from(keyHex, "hex"))
    .digest()
    .subarray(0, 12);
function seal(models, keyHex = KEY, { gzip = true } = {}) {
  const key = Buffer.from(keyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, dataIv(keyHex));
  const plain = gzip
    ? gzipSync(JSON.stringify(models))
    : Buffer.from(JSON.stringify(models));
  const body = Buffer.concat([
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  // Flight 分片是 JS 字符串字面量，引号在原始 HTML 里必须呈转义形态。
  const html =
    '<script>self.__next_f.push([1,"20:[\\"$\\",\\"div\\",null,{' +
    '\\"manifest\\":{\\"path\\":\\"/data/fixture.txt\\",\\"key\\":\\"' +
    keyHex +
    '\\"}}]"]))</script>';
  return { html, body };
}
function serveAA({ html, body }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url === SOURCE_INFO.aa.url) return new Response(html, { status: 200 });
    if (url.endsWith("/data/fixture.txt"))
      return new Response(body, { status: 200 });
    throw new Error("测试未预期的请求：" + url);
  };
  return () => {
    globalThis.fetch = original;
  };
}
const filler = (n) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `model-${i}`,
    name: `Model ${i}`,
    shortName: `Model ${i}`,
    deprecated: false,
    isOpenWeights: i % 2 === 0,
    intelligenceIndex: 10 + i * 0.25,
    intelligenceIndexCostPerTask: i % 4 === 0 ? 0.01 * i : "$undefined",
    price1mInputTokens: 1 + i,
    price1mOutputTokens: 2 + i,
    medianOutputTokensPerSecond: 100 + i,
    medianTimeToFirstTokenSeconds: 0.5,
    modelCreatorName: "Creator",
  }));
test("AA manifest ingestion retains full precision, cost, effort, history and openness", async () => {
  const restore = serveAA(
    seal([
      ...filler(119),
      {
        slug: "legacy-99",
        name: "Legacy 99 (max)",
        shortName: null,
        deprecated: true,
        isOpenWeights: true,
        intelligenceIndex: 12.345,
        intelligenceIndexCostPerTask: 0.002,
        intelligenceIndexIsEstimated: true,
        price1mInputTokens: "$undefined",
        price1mOutputTokens: "$undefined",
        medianOutputTokensPerSecond: 50,
        medianTimeToFirstTokenSeconds: 1.5,
        modelCreatorName: "Old",
      },
    ]),
  );
  try {
    const result = await FETCHERS.aa();
    assert.equal(result.rows.length, 120);
    const r = result.rows.find((x) => x.name === "Legacy 99 (max)");
    assert.equal(r.score, 12.345);
    assert.equal(r.costTask, 0.002);
    assert.equal(r.openWeights, true);
    assert.equal(r.deprecated, true);
    assert.equal(r.estimated, true);
    assert.equal(r.priceInput, null);
    assert.equal(r.priceOutput, null);
    assert.equal(r.speed, 50);
    assert.equal(r.latency, 1.5);
    assert.equal(r.creator, "Old");
    assert.equal(r.url, "https://artificialanalysis.ai/models/legacy-99");
    assert.equal(r.configuration, "Legacy 99 (max)");
    // shortName 缺失时回落到 name；isOpenWeights 逐行保留
    assert.equal(result.rows.filter((x) => x.openWeights === false).length, 59);
    assert.equal(result.sourceDate, null);
  } finally {
    restore();
  }
});
test("AA rejects truncated payloads and payloads missing openness metadata", () => {
  assert.throws(() => parseAA(filler(99)), /不完整/);
  const noFlags = filler(120).map((m, i) =>
    i < 30 ? { ...m, isOpenWeights: undefined } : m,
  );
  assert.throws(() => parseAA(noFlags), /开放权重/);
  assert.throws(() => parseAA("<h1>challenge</h1>"), /模型列表不是数组/);
  // 载荷里混进非对象条目时跳过该行，而不是让 typeof 解引抛 TypeError
  const mixed = [null, undefined, "x", 42, ...filler(120)];
  assert.equal(parseAA(mixed).rows.length, 120);
});
test("AA manifest and payload failures fail clearly instead of returning invented data", async () => {
  assert.throws(() => aaManifest("<h1>challenge</h1>"), /结构变化/);
  const models = filler(120);
  // 密钥不对：AES-GCM 认证失败
  const wrong = seal(models, "bb".repeat(32));
  await assert.rejects(() => decryptAAGzip(wrong.body, KEY), /解密失败/);
  // 密钥不是 32 字节时明确失败，而不是让 WebCrypto 抛难懂的错误
  await assert.rejects(() => decryptAAGzip(wrong.body, "abcd"), /密钥长度异常/);
  // 密文对但明文不是 gzip
  const ungzipped = seal(models, KEY, { gzip: false });
  await assert.rejects(
    () => decryptAAGzip(ungzipped.body, KEY),
    /解压或解析失败/,
  );
  // 页面拿不到 manifest 时，整条链路在第一步就明确失败
  const restore = serveAA({
    html: "<h1>challenge</h1>",
    body: Buffer.alloc(0),
  });
  try {
    await assert.rejects(() => FETCHERS.aa(), /结构变化/);
  } finally {
    restore();
  }
});
test("Vals model row uses th rather than td and keeps cost separate from token pricing", () => {
  const r = parseVals(
    '<p>Updated 10/13/2026</p><table><thead><tr><th>Cost / Test</th></tr></thead><tbody><tr><td>1</td><th scope="row">New 99</th><td>61.15%</td><td>$3.24</td><td>$2 / $10</td><td>4B / 2M</td><td>12m</td></tr></tbody></table>',
  );
  assert.equal(r.rows[0].name, "New 99");
  assert.equal(r.rows[0].score, 61.15);
  assert.equal(r.rows[0].costTask, 3.24);
  assert.equal(r.rows[0].priceOutput, 10);
});
test("LiveBench correctly distinguishes cost per task from successful-task cost", () => {
  const js =
    'const meta={"new-99":{url:"https://example.com",organization:"New",displayName:"New 99",effort:"max",openweight:!0}}';
  const r = parseLivebench(
    "model,coding,reasoning\nnew-99,50,100\n",
    "model,coding,nq_coding,reasoning,nq_reasoning,input_price_per_million,output_price_per_million\nnew-99,20,10,10,20,1,2\n",
    js,
  ).rows[0];
  assert.equal(r.score, 75);
  assert.equal(r.costTask, 1);
  assert.equal(r.costSuccess, 1 / 0.75);
  assert.equal(r.openWeights, true);
  assert.equal(r.name, "New 99");
});
// LiveBench 摄取编排：v1 发布文件在 /v1/table_<日期>.csv，v2 在
// /data/<紧凑日期>/table.csv；站点对未命中路径可能返回 SPA 壳（HTTP 200 + HTML），
// 表头校验是唯一拦网。布局与双形态 id 的来历见 docs/adr/0008。
const LB_HOME =
  '<html><head><script src="/static/js/main.test.js"></script></head></html>';
const LB_JS = [
  'const _e=["20261014"];',
  'const Me=e=>e.slice(0,4)+"-"+e.slice(4,6)+"-"+e.slice(6,8);',
  'const Oe=[...["2024-06-24","2026-06-25"].map((e=>({id:e,label:e,gen:"v1"}))),..._e.map((e=>({id:e,label:Me(e),gen:"v2"})))];',
  'const meta={"new-99":{url:"https://example.com",organization:"New",displayName:"New 99",effort:"max",openweight:!0}};',
].join("\n");
const LB_TABLE = "model,coding,reasoning\nnew-99,50,100\n";
const LB_COST =
  "model,coding,nq_coding,reasoning,nq_reasoning,input_price_per_million,output_price_per_million\nnew-99,20,10,10,20,1,2\n";
const LB_SPA = "<!doctype html><title>livebench.ai</title>";
// routes 登记 pathname → 响应体；未登记的路径一律 404（源站对缺失文件的行为）。
// getText 只接受 2xx，404 即抛错被摄取层捕获后继续探测下一个布局。
function serveLivebench(routes) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : String(input?.url ?? input),
    );
    seen.push(url.pathname);
    const hit = routes[url.pathname];
    return hit === undefined
      ? new Response("", { status: 404 })
      : new Response(hit, { status: 200 });
  };
  return { seen, restore: () => (globalThis.fetch = original) };
}
test("LiveBench ingestion picks the newest release across v1/v2 id forms and layouts", async () => {
  const { seen, restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/data/20261014/table.csv": LB_TABLE,
    "/data/20261014/cost.csv": LB_COST,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].name, "New 99");
    assert.equal(r.sourceDate, "2026-10-14");
    assert.equal(r.releaseKey, "20261014");
    assert.equal(seen[0], "/");
    assert.ok(seen.includes("/static/js/main.test.js"));
    // 最新发布首发命中：不再继续探测旧布局
    assert.equal(seen.filter((p) => p.includes("table")).length, 1);
  } finally {
    restore();
  }
});
test("LiveBench ingestion falls back from v2 layout to v1 layout for older releases", async () => {
  const { seen, restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/v1/table_2026_06_25.csv": LB_TABLE,
    "/v1/cost_2026_06_25.csv": LB_COST,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.sourceDate, "2026-06-25");
    assert.equal(r.releaseKey, "2026-06-25");
    assert.equal(r.rows[0].name, "New 99");
    assert.ok(
      seen.indexOf("/data/20261014/table.csv") <
        seen.indexOf("/v1/table_2026_06_25.csv"),
    );
  } finally {
    restore();
  }
});
test("LiveBench ingestion still accepts the pre-migration root layout", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/table_2026_06_25.csv": LB_TABLE,
    "/cost_2026_06_25.csv": LB_COST,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.sourceDate, "2026-06-25");
    assert.equal(r.rows.length, 1);
  } finally {
    restore();
  }
});
test("LiveBench ingestion rejects SPA shell responses instead of parsing them as data", async () => {
  const { seen, restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    // v2 布局返回 200 但内容是 SPA 壳：必须跳过并落到 v1 真实数据
    "/data/20261014/table.csv": LB_SPA,
    "/v1/table_2026_06_25.csv": LB_TABLE,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.sourceDate, "2026-06-25");
    assert.equal(r.rows[0].score, 75);
    assert.ok(seen.includes("/data/20261014/table.csv"));
  } finally {
    restore();
  }
});
test("LiveBench ingestion treats an HTML-shell cost file as missing, not as costs", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/data/20261014/table.csv": LB_TABLE,
    "/data/20261014/cost.csv": LB_SPA,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.rows[0].costTask, null);
    assert.equal(r.rows[0].priceInput, null);
    assert.equal(r.rows[0].priceOutput, null);
    assert.equal(r.rows[0].score, 75);
  } finally {
    restore();
  }
});
test("LiveBench ingestion failures name the broken contract instead of inventing data", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
  });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /发布文件未找到/);
  } finally {
    restore();
  }
  const noList = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": "console.log('no releases here')",
  });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /发布列表未找到/);
  } finally {
    noList.restore();
  }
  const noScript = serveLivebench({ "/": "<html><p>改版了</p></html>" });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /入口脚本位置变化/);
  } finally {
    noScript.restore();
  }
});
test("parser structure drift fails clearly instead of returning invented data", () => {
  assert.throws(() => parseVals("<h1>new</h1>"), /结构变化/);
});
test("AA missing-value sentinels become null instead of invalid prices", () => {
  const r = parseAA([
    ...filler(119),
    {
      name: "Missing costs",
      isOpenWeights: true,
      intelligenceIndex: 10,
      intelligenceIndexCostPerTask: "$undefined",
      price1mInputTokens: "$undefined",
      price1mOutputTokens: "$undefined",
    },
  ]).rows.at(-1);
  assert.equal(r.costTask, null);
  assert.equal(r.priceInput, null);
  assert.equal(r.priceOutput, null);
});

test("LiveBench retains a source release label distinct from the file key", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js":
      LB_JS + 'const labels={"2026-06-25":"2026-06-26"};',
    "/v1/table_2026_06_25.csv": LB_TABLE,
  });
  try {
    const result = await FETCHERS.livebench();
    assert.equal(result.releaseKey, "2026-06-25");
    assert.equal(result.sourceDate, "2026-06-26");
  } finally {
    restore();
  }
});
