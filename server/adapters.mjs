import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
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
function findModels(o) {
  if (!o || typeof o !== "object") return null;
  if (
    Array.isArray(o.models) &&
    o.models.some((m) => typeof m.isOpenWeights === "boolean")
  )
    return o.models;
  for (const x of Object.values(o)) {
    const found = findModels(x);
    if (found) return found;
  }
  return null;
}
export function parseAA(html) {
  const $ = cheerio.load(html);
  let flight = "";
  $("script").each((_, el) => {
    const s = $(el).html() ?? "";
    if (s.startsWith("self.__next_f.push(")) {
      try {
        const a = JSON.parse(s.slice("self.__next_f.push(".length, -1));
        if (typeof a[1] === "string") flight += a[1];
      } catch {
        /* unrelated Flight chunks */
      }
    }
  });
  let models;
  for (const line of flight.split("\n")) {
    try {
      models = findModels(JSON.parse(line.slice(line.indexOf(":") + 1)));
    } catch {
      /* non-JSON Flight records */
    }
    if (models) break;
  }
  if (!models)
    throw new Error("AA 页面结构变化：找不到含开放权重元数据的模型数据");
  const rows = models
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
      "源站页面内嵌结构化数据；保留完整精度、历史条目、估算标记和推理档位。",
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
export const FETCHERS = {
  aa: async () => parseAA(await getText(SOURCE_INFO.aa.url)),
  vals: async () => parseVals(await getText(SOURCE_INFO.vals.url)),
  livebench: fetchLivebench,
};
