import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
import { gunzipSync } from "node:zlib";
export const SOURCE_INFO = {
  aa: {
    name: "Artificial Analysis",
    url: "https://artificialanalysis.ai/leaderboards/models",
    metric: "Intelligence Index · 任务能力",
  },
  vals: {
    name: "Vals",
    url: "https://www.vals.ai/benchmarks/vals_index",
    metric: "Vals Index · 经济任务",
  },
  livebench: {
    name: "LiveBench",
    url: "https://livebench.ai/",
    metric: "Overall · 七类任务",
  },
};
const number = (s) => {
  const m = String(s ?? "")
    .replaceAll(",", "")
    .match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const prices = (s) =>
  [...String(s).matchAll(/\$([\d.]+)/g)].map((m) => Number(m[1]));
export async function getText(url, timeout = 30000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      "User-Agent": "ModelFrontier/1.0 (personal local leaderboard reader)",
      Accept: "text/html,application/json,text/csv,*/*",
    },
  });
  if (!response.ok) throw new Error(`源站返回 HTTP ${response.status}`);
  return response.text();
}
// AA 的全量模型不再随页面下发，改为放在 manifest 指向的加密文件里：AES-256-GCM 加密后
// gzip 的 JSON。密钥写在同一个 Flight 分片中，IV 取 SHA-256(key) 前 12 字节，认证标签 128 位。
// 见 docs/adr/0006。 Flight 分片是 JS 字符串字面量，引号在原始 HTML 里呈转义形态。
const MANIFEST_RE =
  /manifest\\?":\{\\?"path\\?":\\?"([^"\\]+)\\?",\\?"key\\?":\\?"([0-9a-fA-F]+)\\?"\}/;
const AA_MIN_ROWS = 100;
const AA_OPEN_FLAG_RATIO = 0.9;
export function aaManifest(html) {
  const m = MANIFEST_RE.exec(String(html));
  if (!m) throw new Error("AA 页面结构变化：找不到数据清单 manifest");
  return { path: m[1], key: m[2] };
}
export async function decryptAAGzip(buffer, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("AA 数据密钥长度异常");
  const iv = new Uint8Array(await crypto.subtle.digest("SHA-256", key)).slice(
    0,
    12,
  );
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  let packed;
  try {
    packed = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      cryptoKey,
      buffer,
    );
  } catch {
    throw new Error("AA 数据解密失败：加密方案可能已变更");
  }
  try {
    return JSON.parse(gunzipSync(packed).toString("utf8"));
  } catch {
    throw new Error("AA 数据解压或解析失败");
  }
}
export function parseAA(models) {
  if (!Array.isArray(models))
    throw new Error("AA 数据格式变化：模型列表不是数组");
  if (models.length < AA_MIN_ROWS)
    throw new Error(
      `AA 数据不完整：仅解析到 ${models.length} 条，低于 ${AA_MIN_ROWS} 条下限`,
    );
  // 开放权重缺失时不能放行：全表会安静退化成「开放状态未知」，比报错更糟。
  // 分母取可评估的对象行数，否则载荷里混进 null 会把「全都有标记」误判成缺失。
  const objects = models.filter((m) => m && typeof m === "object");
  const flagged = objects.filter(
    (m) => typeof m.isOpenWeights === "boolean",
  ).length;
  if (flagged < objects.length * AA_OPEN_FLAG_RATIO)
    throw new Error("AA 数据缺少开放权重元数据，拒绝替换缓存");
  const rows = objects
    .filter((m) => typeof m.name === "string")
    .map((m) => ({
      name: m.shortName ?? m.name,
      score: Number.isFinite(m.intelligenceIndex) ? m.intelligenceIndex : null,
      costTask: Number.isFinite(m.intelligenceIndexCostPerTask)
        ? m.intelligenceIndexCostPerTask
        : null,
      priceInput: Number.isFinite(m.price1mInputTokens)
        ? m.price1mInputTokens
        : null,
      priceOutput: Number.isFinite(m.price1mOutputTokens)
        ? m.price1mOutputTokens
        : null,
      speed: Number.isFinite(m.medianOutputTokensPerSecond)
        ? m.medianOutputTokensPerSecond
        : null,
      latency: Number.isFinite(m.medianTimeToFirstTokenSeconds)
        ? m.medianTimeToFirstTokenSeconds
        : null,
      creator: m.modelCreatorName,
      openWeights: m.isOpenWeights,
      deprecated: !!m.deprecated,
      estimated: !!m.intelligenceIndexIsEstimated,
      url: `https://artificialanalysis.ai/models/${m.slug}`,
      configuration: m.name,
    }));
  return {
    rows,
    sourceDate: null,
    notes: [
      "源站页面 manifest 指向的加密数据文件；保留完整精度、历史条目、估算标记和推理档位。",
      "开放权重、历史与估算状态均取自源站字段，不按模型名推测。",
    ],
  };
}
function tableRows($, table) {
  return $(table)
    .find("tbody tr")
    .toArray()
    .map((tr) =>
      $(tr)
        .find("td, th")
        .toArray()
        .map((td) => $(td).text().trim()),
    );
}
export function parseVals(html) {
  const $ = cheerio.load(html);
  const table = $("table")
    .toArray()
    .find((t) => $(t).text().includes("Cost / Test"));
  if (!table) throw new Error("Vals 页面结构变化：找不到 Vals Index 表");
  const rows = tableRows($, table)
    .filter((r) => r.length >= 7 && number(r[2]) !== null)
    .map((r) => {
      const p = prices(r[4]);
      return {
        name: r[1],
        score: number(r[2]),
        costTask: number(r[3]),
        priceInput: p[0] ?? null,
        priceOutput: p[1] ?? null,
        duration: r[6],
        url: SOURCE_INFO.vals.url,
        configuration: r[1],
        openWeights: null,
      };
    });
  return {
    rows,
    sourceDate:
      $.text().match(/Updated\s+(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? null,
    notes: ["Cost / Test 只代表 Vals 的任务与执行协议，不等于生产调用预算。"],
  };
}
function scalar(body, key) {
  return body.match(new RegExp(`(?:^|,)${key}:"([^"]*)"`))?.[1] ?? null;
}
export function lbMetadata(js) {
  const metadata = {};
  for (const m of js.matchAll(
    /(?:"([^"]+)"|([\w$-]+)):\{([^{}]{0,1800}organization:"[^"]+"[^{}]*)\}/g,
  )) {
    const [, quoted, key, body] = m;
    metadata[quoted ?? key] = {
      name: scalar(body, "displayName"),
      creator: scalar(body, "organization"),
      configuration: scalar(body, "effort"),
      openWeights: /openweight:!0|openweight:true/.test(body) ? true : null,
      url: scalar(body, "url"),
    };
  }
  return metadata;
}
export function parseLivebench(csv, costCsv, js) {
  const input = parse(csv, { columns: true, skip_empty_lines: true });
  if (!input.length || !("model" in input[0]))
    throw new Error("LiveBench CSV 表头变化");
  const costs = new Map(
    (costCsv
      ? parse(costCsv, { columns: true, skip_empty_lines: true })
      : []
    ).map((r) => [r.model, r]),
  );
  const metadata = lbMetadata(js);
  const rows = input.map((r) => {
    const meta = metadata[r.model] ?? {};
    const suites = Object.fromEntries(
      Object.entries(r)
        .filter(
          ([k, v]) => k !== "model" && v !== "" && Number.isFinite(Number(v)),
        )
        .map(([k, v]) => [k, Number(v)]),
    );
    const values = Object.values(suites);
    const score = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
    const c = costs.get(r.model);
    let sumCost = 0,
      sumTasks = 0;
    if (c)
      for (const k of Object.keys(suites)) {
        if (
          c[k] !== "" &&
          c["nq_" + k] !== "" &&
          Number.isFinite(Number(c[k])) &&
          Number(c["nq_" + k]) > 0
        ) {
          sumCost += Number(c[k]);
          sumTasks += Number(c["nq_" + k]);
        }
      }
    const costTask = sumTasks > 0 ? sumCost / sumTasks : null;
    return {
      name: meta.name ?? r.model,
      score,
      costTask,
      costSuccess:
        costTask !== null && score > 0 ? costTask / (score / 100) : null,
      priceInput: c ? number(c.input_price_per_million) : null,
      priceOutput: c ? number(c.output_price_per_million) : null,
      suites,
      creator: meta.creator,
      openWeights: meta.openWeights ?? null,
      configuration: meta.configuration ?? "源站未披露",
      url: SOURCE_INFO.livebench.url,
      rawId: r.model,
    };
  });
  return {
    rows,
    notes: [
      "Overall 为可用 suite 等权均值；默认最高支持 effort，以源站元数据为准。",
      "LiveBench 成本使用每次任务成本，不与每次成功任务成本混用。",
    ],
  };
}
export async function fetchLivebench() {
  const html = await getText(SOURCE_INFO.livebench.url);
  const $ = cheerio.load(html);
  const path = $("script[src]")
    .toArray()
    .map((e) => $(e).attr("src"))
    .find((s) => /main\..*\.js/.test(s));
  if (!path) throw new Error("LiveBench 入口脚本位置变化");
  const js = await getText(new URL(path, SOURCE_INFO.livebench.url));
  const labels = Object.fromEntries(
    [...js.matchAll(/"(20\d{2}-\d{2}-\d{2})":"(20\d{2}-\d{2}-\d{2})"/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
  const dates = [
    ...new Set(
      [...Object.keys(labels), ...js.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map(
        (x) => (typeof x === "string" ? x : x[0]),
      ),
    ),
  ]
    .sort()
    .reverse()
    .slice(0, 18);
  for (const date of dates) {
    let csv;
    try {
      csv = await getText(
        `https://livebench.ai/table_${date.replaceAll("-", "_")}.csv`,
        12000,
      );
    } catch {
      continue;
    }
    if (!csv.startsWith("model,")) continue;
    const costCsv = await getText(
      `https://livebench.ai/cost_${date.replaceAll("-", "_")}.csv`,
      12000,
    ).catch(() => null);
    return {
      ...parseLivebench(csv, costCsv, js),
      sourceDate: labels[date] ?? date,
      releaseKey: date,
    };
  }
  throw new Error("LiveBench 发布文件未找到；保留上次数据");
}
async function getBuffer(url, timeout = 30000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      "User-Agent": "ModelFrontier/1.0 (personal local leaderboard reader)",
      Accept: "*/*",
    },
  });
  if (!response.ok) throw new Error(`源站返回 HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function fetchAA() {
  const html = await getText(SOURCE_INFO.aa.url);
  const { path, key } = aaManifest(html);
  return parseAA(
    await decryptAAGzip(
      await getBuffer(new URL(path, SOURCE_INFO.aa.url)),
      key,
    ),
  );
}
export const FETCHERS = {
  aa: fetchAA,
  vals: async () => parseVals(await getText(SOURCE_INFO.vals.url)),
  livebench: fetchLivebench,
};
