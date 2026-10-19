import { parquetReadObjects } from "hyparquet";
import { licenseState } from "./identity.mjs";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
import { gunzipSync } from "node:zlib";
export const SOURCE_INFO = {
  arena: {
    name: "Arena",
    url: "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset",
    metric: "Text Overall · 人类盲测偏好",
  },
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
// 多站抓取共用：超时、明确的身份声明、HTTP 状态检查。getText / getBuffer 原本各写一份
// fetch，只差 Accept，收敛到一处，少一处会漂移的重复。
async function requestSource(url, timeout = 30000, accept = "*/*") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      "User-Agent": "ModelFrontier/1.0 (personal local leaderboard reader)",
      Accept: accept,
    },
  });
  if (!response.ok) throw new Error(`源站返回 HTTP ${response.status}`);
  return response;
}
export async function getText(url, timeout = 30000) {
  const response = await requestSource(
    url,
    timeout,
    "text/html,application/json,text/csv,*/*",
  );
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
// LiveBench 元数据只取这四个键。正则预编译一次：既免去每条模型解析都重编一遍，也去掉
// 动态构造的正则（键虽是本文件内的固定字面量，仍不该留给 detect-non-literal-regexp 告警）。
const LB_SCALAR_RE = {
  displayName: /(?:^|,)displayName:"([^"]*)"/,
  organization: /(?:^|,)organization:"([^"]*)"/,
  effort: /(?:^|,)effort:"([^"]*)"/,
  url: /(?:^|,)url:"([^"]*)"/,
};
function scalar(body, key) {
  const re = LB_SCALAR_RE[key];
  // 键不在表内时返回 null：不能让它变成 match(undefined) 而命中整个 body
  return re ? (body.match(re)?.[1] ?? null) : null;
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
// LiveBench 发布 id 有两种形态：v1 代是虚线日期（"2026-06-25"），数据文件在
// /v1/table_<日期>.csv；v2 代是紧凑日期（"20261014"），数据文件在
// /data/<id>/table.csv。2026-10 站点改版：v1 文件从根目录迁到 /v1/，同时引入 v2
// 目录布局——旧实现「扫 JS 里的虚线日期 + 只猜根路径」因此全部 404（v2 的紧凑 id
// 压根不出现在虚线日期扫描里，见 docs/adr/0008）。现在从入口 JS 枚举两种形态的
// 候选发布（新→旧），每种按「现行布局 → 历史布局」探测，以 CSV 表头校验命中；
// 站点再改版时通常只需往 lbLayouts 里加一项，不必重新踩坑。
const LB_MAX_RELEASES = 12;
const LB_FILE_TIMEOUT = 12000;
const lbDashed = (id) =>
  id.includes("-")
    ? id
    : `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
function lbReleaseIds(js) {
  const dashed = [...js.matchAll(/"(20\d{2}-\d{2}-\d{2})"/g)].map((m) => m[1]);
  const compact = [...js.matchAll(/"(20\d{6})"/g)].map((m) => m[1]);
  return [...new Set([...dashed, ...compact])]
    .map((id) => ({ id, sort: lbDashed(id) }))
    .sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0))
    .slice(0, LB_MAX_RELEASES)
    .map((r) => r.id);
}
// 每个候选发布的 [table, cost] 布局对，按该 id 形态的现行布局优先，并交叉探测
// 另一种形态的布局——任一层重新启用或回迁都能接住。
function lbLayouts(id) {
  const under = lbDashed(id).replaceAll("-", "_");
  const v1 = [`v1/table_${under}.csv`, `v1/cost_${under}.csv`];
  const root = [`table_${under}.csv`, `cost_${under}.csv`];
  const v2 = [`data/${id}/table.csv`, `data/${id}/cost.csv`];
  return id.includes("-") ? [v1, root, v2] : [v2, v1, root];
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
  // 文件键与展示发布日期可能不同，保留源站明确给出的日期映射。
  const labels = Object.fromEntries(
    [...js.matchAll(/"(20\d{2}-\d{2}-\d{2})":"(20\d{2}-\d{2}-\d{2})"/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
  const releases = lbReleaseIds(js);
  if (!releases.length)
    throw new Error("LiveBench 发布列表未找到；保留上次数据");
  for (const id of releases) {
    for (const [tablePath, costPath] of lbLayouts(id)) {
      const csv = await getText(
        new URL(tablePath, SOURCE_INFO.livebench.url),
        LB_FILE_TIMEOUT,
      ).catch(() => null);
      // 站点对未命中路径返回 SPA 壳（HTTP 200 + HTML），表头是唯一的拦网；
      // cost 同理，拿到 HTML 壳按缺失处理，不把解析垃圾当成本。
      if (!csv || !csv.startsWith("model,")) continue;
      const cost = await getText(
        new URL(costPath, SOURCE_INFO.livebench.url),
        LB_FILE_TIMEOUT,
      ).catch(() => null);
      return {
        ...parseLivebench(csv, cost?.startsWith("model,") ? cost : null, js),
        sourceDate: labels[id] ?? lbDashed(id),
        releaseKey: id,
      };
    }
  }
  throw new Error("LiveBench 发布文件未找到；保留上次数据");
}
async function getBuffer(url, timeout = 30000) {
  const response = await requestSource(url, timeout);
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
// Arena 文本总榜使用官方单文件快照，避免依赖页面渲染或不稳定的筛选服务。
export const ARENA_FORMAT = "arena-text-overall-v1";
const ARENA_DATA_URL =
  "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text/latest-00000-of-00001.parquet";
const ARENA_CREATORS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  xiaomi: "Xiaomi",
  deepseek: "DeepSeek",
  zai: "Z AI",
  moonshot: "Kimi",
  alibaba: "Alibaba",
  stepfun: "StepFun",
  xai: "xAI",
};
// V8 的 Date.parse 会把「2026-02-30」滚动成 3 月 2 日，必须在解析后回读 UTC 分量
// 确认日、月、年没有进位，才能当真实日历日期接受。
const isValidArenaDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return false;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const parsed = new Date(t);
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
};
export function parseArena(data) {
  if (!Array.isArray(data))
    throw new Error("Arena 数据格式变化：模型列表不是数组");
  const overall = data.filter((r) => r?.category === "overall");
  if (!overall.length) throw new Error("Arena 数据缺少文本 overall 总榜");
  const names = new Set();
  const dates = new Set();
  const rows = overall.map((r) => {
    if (
      typeof r.model_name !== "string" ||
      !r.model_name.trim() ||
      !Number.isFinite(r.rating) ||
      !Number.isFinite(r.vote_count) ||
      r.vote_count < 0 ||
      !Number.isFinite(r.rating_lower) ||
      !Number.isFinite(r.rating_upper) ||
      r.rating_lower > r.rating ||
      r.rating_upper < r.rating ||
      !isValidArenaDate(r.leaderboard_publish_date)
    )
      throw new Error(
        `Arena 文本总榜存在无效的模型、评分、票数、区间或发布日期：${
          typeof r?.model_name === "string" && r.model_name.trim()
            ? r.model_name
            : `第 ${overall.indexOf(r) + 1} 行（无有效名称）`
        }`,
      );
    if (names.has(r.model_name)) throw new Error("Arena 文本总榜存在重复配置");
    names.add(r.model_name);
    dates.add(r.leaderboard_publish_date);
    // 真实快照存在空串 organization；空串会穿透 ?? 链变成空 creator，必须先归一化
    const organization =
      typeof r.organization === "string" && r.organization.trim()
        ? r.organization.trim()
        : null;
    return {
      rawId: r.model_name,
      name: r.model_name,
      configuration: r.model_name,
      creator: organization
        ? (ARENA_CREATORS[organization] ?? organization)
        : "未披露",
      score: r.rating,
      voteCount: r.vote_count,
      scoreLower: r.rating_lower,
      scoreUpper: r.rating_upper,
      publishedAt: r.leaderboard_publish_date,
      license: r.license ?? null,
      openWeights: licenseState(r.license),
      costTask: null,
      url: SOURCE_INFO.arena.url,
    };
  });
  if (dates.size !== 1)
    throw new Error("Arena 文本总榜发布日期不一致，拒绝混合快照");
  return {
    rows,
    sourceDate: [...dates][0],
    ingestFormat: ARENA_FORMAT,
    notes: [
      "Arena 官方 Hugging Face 数据集 text / latest / overall；每模型族取非估算、非历史且分数最高的配置。",
      "人类盲测偏好评分；票数和区间仅属于 Arena，不是综合评分置信度。Arena 未提供任务成本。",
    ],
  };
}
export async function fetchArena() {
  const response = await requestSource(ARENA_DATA_URL);
  const file = await response.arrayBuffer();
  return parseArena(await parquetReadObjects({ file }));
}

export const FETCHERS = {
  arena: fetchArena,
  aa: fetchAA,
  vals: async () => parseVals(await getText(SOURCE_INFO.vals.url)),
  livebench: fetchLivebench,
};
