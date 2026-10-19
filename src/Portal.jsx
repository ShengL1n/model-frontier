import { useMemo } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Progress,
  Select,
  Segmented,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  ExportOutlined,
  SearchOutlined,
  SwapOutlined,
  TrophyOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { NAMES, COSTS, costFormat, money } from "./presentation.mjs";
import { csvExport } from "./analysis.mjs";
import {
  coverageSummary,
  filterModels,
  nativeCsvExport,
  nativeRanking,
  rankedModels,
  applyBudget,
  budgetSummary,
  livebenchSuiteKeys,
  vendorChipCounts,
  SOURCE_IDS,
} from "./portal.mjs";
import CompareChart from "./CompareChart.jsx";
import { majorityMatch } from "./analysis.mjs";
import {
  ArenaEvidence,
  ConfigurationDetails,
  EvidenceBadges,
  SourceQuality,
  QualityNote,
  HistorySummary,
} from "./Evidence.jsx";
import { sourceHealth } from "./evidence.mjs";
const number = (v) => (Number.isFinite(v) ? v.toFixed(1) : "未披露");
// 四来源徽标配色（原 .source-aa/.source-vals/.source-livebench，键与 SOURCE_IDS 对应）
const SOURCE_TONE = {
  aa: "bg-[#e7eef9] text-[#416795]",
  vals: "bg-[#eeeaf7] text-[#7e60a7]",
  livebench: "bg-[#e5f3ef] text-[#137964]",
  arena: "bg-[#f2eafa] text-[#76559a]",
};
const stateTag = (r) => (
  <Tag color={r.openWeights === true ? "green" : "default"}>
    {r.openConflict
      ? "开放状态有分歧"
      : r.openWeights === true
        ? "开放权重"
        : r.openWeights === false
          ? "闭源"
          : "未确认"}
  </Tag>
);
const scoreCell = (v) =>
  Number.isFinite(v) ? (
    <span className="block max-w-[90px] font-[650] tabular-nums text-[#106e61]">
      {v.toFixed(1)}
      <span className="mt-[7px] block h-[3px] rounded-[4px] bg-[#e8efed]">
        <i
          className="block h-full rounded-[4px] bg-[#56a190]"
          style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
        />
      </span>
    </span>
  ) : (
    <span className="text-[10px] leading-[1.85] text-[#6b818f]">未评分</span>
  );
const nameCell = (r, onSelect, id = r.id) => (
  <button className="model-link" onClick={() => onSelect(id)}>
    <span>
      {r.name}
      <small>{r.creator}</small>
    </span>
  </button>
);
// 厂商快捷筛选行：chip 与「排行榜厂商」下拉同源（creator 字段），再次点击取消；
// 计数口径与下拉一致（当前视图完整行池），0 命中置灰避免点出空表；但激活态永不置灰——
// 已选中的筛选必须始终可取消（切换源站后某厂商记录归零时该状态可达），禁用只针对未激活的空 chip。
// 只改变显示，不影响分数、名次与前沿成员。
export function CreatorChips({ chips, creator, onChange, className = "" }) {
  return (
    <div
      className={
        "creator-chips flex flex-wrap items-center gap-[7px] " + className
      }
      role="group"
      aria-label="厂商快捷筛选"
    >
      <span className="text-[10px] font-[650] tracking-[0.06em] text-[#7b958d]">
        厂商快捷筛选
      </span>
      {chips.map((chip) => {
        const active = creator === chip.value;
        const empty = chip.count === 0;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            disabled={empty && !active}
            title={
              `厂商 ${chip.value}` +
              (chip.note ? ` · ${chip.note}` : "") +
              " · 完整列表见「全部厂商」下拉" +
              (active || !empty
                ? "；再次点击取消筛选"
                : "；当前视图暂无该厂商配置")
            }
            className={
              "creator-chip inline-flex items-center gap-[5px] rounded-full border px-[10px] py-[2px] text-[11px] leading-[1.7] transition-colors " +
              (active
                ? "border-[#128574] bg-[#eaf5f1] font-medium text-[#0c6e5e]"
                : "border-[#dce7e3] bg-white text-[#5f7c74] hover:border-[#a8cdc0] hover:text-[#2c6f60]") +
              (empty && !active
                ? " cursor-not-allowed opacity-40"
                : " cursor-pointer")
            }
            onClick={() => onChange(active ? undefined : chip.value)}
          >
            {chip.label}
            <small className="text-[9px] font-normal tabular-nums opacity-70">
              {chip.count}
            </small>
          </button>
        );
      })}
      <span className="text-[9px] text-[#9aabb5]">
        只改变显示 · 完整列表见厂商下拉
      </span>
    </div>
  );
}

export function Overview({
  models,
  analysis,
  data,
  onNavigate,
  onSelect,
  onQuickCompare,
  includeEstimated,
  onOpenHistory,
}) {
  const ranked = useMemo(
    () => rankedModels(analysis.rows).filter((r) => r.rank != null),
    [analysis.rows],
  );
  const open = rankedModels(ranked.filter((r) => r.openWeights === true));
  const coverage = useMemo(
    () => coverageSummary(models, { includeEstimated }),
    [models, includeEstimated],
  );
  const leaders = (items, label, icon) => (
    <section className="min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
      <div className="portal-section-heading">
        <div>
          <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
            {label === "综合能力领先"
              ? "OVERALL LEADERS"
              : "OPEN WEIGHT LEADERS"}
          </span>
          <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
            {icon}
            {label}
          </h2>
        </div>
        <Button
          type="text"
          onClick={() => onNavigate("rankings")}
          icon={<ArrowRightOutlined aria-hidden="true" />}
        >
          完整榜单
        </Button>
      </div>
      {items.length ? (
        items.slice(0, 5).map((r) => (
          <div className="leader-row" key={r.id}>
            <span className={"rank-badge " + (r.rank === 1 ? "first" : "")}>
              {r.rank}
            </span>
            {nameCell(r, onSelect)}
            <div className="leader-score">
              <b>{number(r.composite)}</b>
              <small>
                {r.available.length}/{analysis.sources.length} 榜
              </small>
            </div>
          </div>
        ))
      ) : (
        <Empty description="当前评分口径下没有候选模型" />
      )}
      <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
        {label === "综合能力领先"
          ? "按当前融合积分排序，不要求成本已披露；默认至少两榜准入，票数不足的对决不计入战绩。"
          : "在开放权重模型内排序；分数保持全球样本口径。"}{" "}
        并列分数无严格先后。
      </p>
    </section>
  );
  return (
    <div className="min-w-0">
      <section className="portal-hero">
        <div>
          <div className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
            FOUR SOURCES. ONE WORKSPACE.
          </div>
          <h2 className="mt-[14px] mb-[10px] text-[28px] font-semibold leading-[1.45] tracking-[-0.04em] text-[#203e3b] max-1180:text-[25px] max-760:text-[24px]">
            从榜单，到你的模型选择
          </h2>
          <p className="m-0 max-w-[600px] text-[13px] leading-[1.95] text-[#5f7c77] max-760:text-[12px]">
            先看能力排名，再核对任务表现、价格与配置。四个来源的证据并排呈现，每一个综合结论都能回到原始数据。
          </p>
          <div className="hero-actions">
            <Button
              type="primary"
              onClick={() => onNavigate("rankings")}
              icon={<TrophyOutlined aria-hidden="true" />}
            >
              探索融合排行榜
            </Button>
            <Button
              onClick={() => onQuickCompare(open.slice(0, 3).map((r) => r.id))}
              disabled={open.length < 2}
              icon={<SwapOutlined aria-hidden="true" />}
            >
              对比开放权重领先模型
            </Button>
          </div>
        </div>
        <div className="hero-source-stack">
          {SOURCE_IDS.map((s, i) => (
            <div
              key={s}
              className="flex items-center gap-[12px] rounded-[9px] border border-[#e1ebe7] bg-[#ffffffc9] px-[16px] py-[13px] max-760:p-[12px]"
            >
              <span className={"source-symbol " + (SOURCE_TONE[s] ?? "")}>
                {["AA", "V", "LB", "AR"][i]}
              </span>
              <div className="flex-1">
                <b className="block text-[12px] font-semibold">{NAMES[s]}</b>
                <small className="mt-[5px] block text-[10px] text-[#617b77]">
                  {data?.sources[s]?.metric}
                </small>
              </div>
              <Tag
                color={
                  data?.sources[s]?.stale
                    ? "orange"
                    : data?.sources[s]?.count
                      ? "green"
                      : "default"
                }
              >
                {data?.sources[s]?.stale
                  ? "历史缓存"
                  : data?.sources[s]?.count
                    ? "已同步"
                    : "待获取"}
              </Tag>
            </div>
          ))}
        </div>
      </section>
      <SourceQuality sources={data?.sources} />
      <QualityNote />
      <HistorySummary history={data?.history} onOpen={onOpenHistory} />
      <div className="mb-[20px] grid grid-cols-[1fr_1fr] gap-[20px] max-1180:gap-[16px] max-760:grid-cols-[minmax(0,1fr)]">
        {leaders(ranked, "综合能力领先", <TrophyOutlined aria-hidden="true" />)}
        {leaders(open, "开放权重领先", <UnlockOutlined aria-hidden="true" />)}
      </div>
      <div className="mb-[20px] grid grid-cols-[1fr_1fr] gap-[20px] max-1180:gap-[16px] max-760:grid-cols-[minmax(0,1fr)]">
        <section className="min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
          <div className="portal-section-heading">
            <div>
              <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
                EVIDENCE COVERAGE
              </span>
              <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                模型覆盖与证据
              </h2>
            </div>
            <Tag>覆盖不加分</Tag>
          </div>
          <div className="coverage-distribution">
            {[4, 3, 2, 1, 0].map((n) => (
              <div key={n}>
                <span className="text-[11px] text-[#627c87]">
                  {n} 榜有效分数
                </span>
                <b className="mt-[8px] mb-[5px] block text-[25px] font-semibold tabular-nums">
                  {coverage.groups[n]}
                  <small className="text-[10px] font-normal text-[#708790]">
                    {" "}
                    个模型族
                  </small>
                </b>
                <Progress
                  percent={
                    models.length
                      ? (coverage.groups[n] / models.length) * 100
                      : 0
                  }
                  showInfo={false}
                  strokeColor={
                    n === 4 ? "#0c806e" : n === 2 ? "#557daa" : "#a5b5c4"
                  }
                />
              </div>
            ))}
          </div>
          <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
            按当前质量排除与估算开关统计四站有效分数，与权重无关。仅一榜或无有效分数的模型仍可在模型库中检索。
          </p>
        </section>
        <section className="min-w-0 rounded-[13px] border border-line bg-surface p-[24px] shadow-card max-1180:p-[20px] max-760:p-[20px]">
          <div className="portal-section-heading">
            <div>
              <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
                EXPLORE WITH CONTEXT
              </span>
              <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                换个视角看模型
              </h2>
            </div>
          </div>
          {[
            {
              tab: "compare",
              title: "模型对比",
              text: "并排核对原始分、能力侧重与真实价格",
              icon: <SwapOutlined />,
            },
            {
              tab: "explore",
              title: "成本与帕累托",
              text: "找到不同能力与预算下的不可支配选项",
              icon: <ArrowRightOutlined />,
            },
            {
              tab: "sources",
              title: "数据与采集状态",
              text: "查看成功获取时间、来源协议和错误记录",
              icon: <CheckCircleOutlined />,
            },
          ].map((x) => (
            <button
              className="path-link group"
              key={x.tab}
              onClick={() => onNavigate(x.tab)}
            >
              <span
                className="grid h-[35px] w-[35px] shrink-0 place-items-center rounded-[9px] bg-[#f0f6f5] text-[17px] text-[#397f72]"
                aria-hidden="true"
              >
                {x.icon}
              </span>
              <span className="flex-1">
                <b className="block text-[13px] font-[550] group-hover:text-green">
                  {x.title}
                </b>
                <small className="mt-[6px] block text-[11px] leading-[1.7] text-[#68808e]">
                  {x.text}
                </small>
              </span>
              <ArrowRightOutlined aria-hidden="true" />
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

export function Rankings({
  models,
  analysis,
  controls,
  costSource,
  onSelect,
  selection,
  onSelectionChange,
  onExport,
  excludeStale,
  sources,
  ranking,
  onRanking,
  budget,
  exportMeta,
}) {
  const {
    view,
    query,
    creator,
    openness,
    scoredOnly,
    nativeEstimates,
    nativeHistorical,
    showSuites,
  } = ranking;
  const ranked = useMemo(() => rankedModels(analysis.rows), [analysis.rows]);
  const native = useMemo(
    () =>
      view === "fusion"
        ? []
        : nativeRanking(models, view, {
            includeEstimated: nativeEstimates,
            includeHistorical: nativeHistorical,
          }),
    [models, view, nativeEstimates, nativeHistorical],
  );
  const pool = view === "fusion" ? ranked : native;
  // chip 计数与厂商下拉同口径：当前视图完整行池，不被搜索 / 开放状态提前裁剪。
  const chips = useMemo(() => vendorChipCounts(pool), [pool]);
  // 预算筛选只作用于融合总榜：单榜视图保留源站全部配置作原始证据，不参与预算截断。
  const budgeted = useMemo(
    () => (view === "fusion" ? applyBudget(pool, budget) : pool),
    [pool, budget, view],
  );
  const budgetNote = useMemo(
    () => (view === "fusion" ? budgetSummary(pool, budget) : null),
    [pool, budget, view],
  );
  // 预算来源被质量排除时该源不产生任何代表配置，整表隐藏；必须点破原因，避免被误读为预算设低了。
  // 前置条件是「排除过期 / 失败缓存」开关开启：开关关闭时超期来源的代表配置保留，预算照常按真实成本过滤。
  const budgetExcluded =
    view === "fusion" &&
    excludeStale &&
    budget?.budgetSource &&
    budget.budgetSource !== "none" &&
    sourceHealth(sources?.[budget.budgetSource]).excluded;
  const filtered = filterModels(budgeted, {
    query,
    creator,
    openness,
    scoredOnly: view === "fusion" && scoredOnly,
  });
  const suiteKeys = useMemo(
    () => (view === "fusion" && showSuites ? livebenchSuiteKeys(models) : []),
    [models, showSuites, view],
  );
  const suiteColumns = suiteKeys.map((key) => ({
    title: (
      <Tooltip
        title={`LiveBench「${SUITES[key] ?? key}」分类原始分（0–100）。仅 LiveBench 提供能力维度；AA、Vals 无对应数据，缺失保持空白。排序只改变显示顺序，不改变综合分与名次。`}
      >
        <span className="inline-flex items-baseline gap-[5px]">
          {SUITES[key] ?? key}
          <small className="text-[8px] font-medium text-[#8aa0b4]">LB</small>
        </span>
      </Tooltip>
    ),
    key: "suite-" + key,
    width: 92,
    sorter: (a, b) =>
      (a.representatives.livebench?.suites?.[key] ?? -Infinity) -
      (b.representatives.livebench?.suites?.[key] ?? -Infinity),
    render: (_, r) => {
      const v = r.representatives.livebench?.suites?.[key];
      return Number.isFinite(v) ? (
        <span className="number">{v.toFixed(1)}</span>
      ) : (
        <span className="text-[10px] leading-[1.85] text-[#6b818f]">—</span>
      );
    },
  }));
  const sourceColumns = SOURCE_IDS.map((s) => ({
    title: (
      <Tooltip title="源站原始总分；不同榜单量纲不同，不直接相加">
        {NAMES[s]}
      </Tooltip>
    ),
    key: s,
    width: 145,
    sorter: (a, b) =>
      (a.representatives[s]?.score ?? -Infinity) -
      (b.representatives[s]?.score ?? -Infinity),
    render: (_, r) => {
      const raw = r.representatives[s];
      return (
        <div className="source-score">
          <b>{number(raw?.score)}</b>
          <small>
            {raw?.estimated ? "估算 · " : ""}
            {r.percentiles[s] != null
              ? `${"样本内位置（不计主积分）"} ${number(r.percentiles[s])}`
              : "未参与当前评分"}
          </small>
        </div>
      );
    },
  }));
  const columns =
    view === "fusion"
      ? [
          {
            title: "综合名次",
            dataIndex: "rank",
            width: 80,
            fixed: "left",
            render: (v) =>
              v == null ? (
                "未排名"
              ) : (
                <span className={"rank-badge " + (v === 1 ? "first" : "")}>
                  {v}
                </span>
              ),
          },
          {
            title: "模型",
            width: 220,
            fixed: "left",
            render: (_, r) => nameCell(r, onSelect),
          },
          { title: "开放状态", width: 130, render: (_, r) => stateTag(r) },
          {
            title: "多数对决积分",
            dataIndex: "composite",
            width: 115,
            sorter: (a, b) =>
              (a.composite ?? -Infinity) - (b.composite ?? -Infinity) ||
              (a.auxiliary ?? -Infinity) - (b.auxiliary ?? -Infinity),
            render: (value, row) => (
              <div>
                {scoreCell(value)}
                {row.record && value != null && (
                  <small className="block text-[10px] text-[#627987]">
                    {row.record.wins} 胜 / {row.record.draws} 平 /{" "}
                    {row.record.losses} 负 · {row.record.opponents} 个对手
                  </small>
                )}
              </div>
            ),
          },
          ...[
            {
              title: (
                <Tooltip title="仅当主积分完全相同时用于排序：已有榜单的排名百分位等权平均，不参与帕累托判断">
                  同积分辅助分
                </Tooltip>
              ),
              dataIndex: "auxiliary",
              width: 135,
              render: number,
            },
          ],
          ...sourceColumns,
          ...suiteColumns,
          {
            title: "评分覆盖",
            width: 110,
            render: (_, r) => (
              <Tooltip
                title={
                  r.available.map((s) => NAMES[s]).join(" / ") ||
                  "没有有效评分来源"
                }
              >
                <Tag color={r.complete ? "green" : "default"}>
                  {r.available.length}/{analysis.sources.length} 榜
                  {r.complete ? "" : " · 部分"}
                </Tag>
              </Tooltip>
            ),
          },
          {
            title: COSTS[costSource],
            width: 170,
            render: (_, r) => costFormat(r.cost, costSource),
          },
        ]
      : [
          {
            title: "源站名次",
            dataIndex: "rank",
            width: 80,
            fixed: "left",
            render: (v) => v ?? "未排名",
          },
          {
            title: "模型配置",
            width: 300,
            fixed: "left",
            render: (_, r) => (
              <div>
                {nameCell({ ...r, name: r.configuration }, onSelect, r.modelId)}
                {r.estimated && <Tag color="orange">估算</Tag>}
                {r.deprecated && <Tag>历史</Tag>}
              </div>
            ),
          },
          { title: "开放状态", width: 130, render: (_, r) => stateTag(r) },
          {
            title: "原始总分",
            dataIndex: "score",
            width: 120,
            sorter: (a, b) => (a.score ?? -Infinity) - (b.score ?? -Infinity),
            render: (value, row) => (
              <div>
                {number(value)}
                {view === "arena" && <ArenaEvidence record={row} />}
              </div>
            ),
          },
          {
            title: "任务成本 USD",
            dataIndex: "costTask",
            width: 150,
            render: money,
          },
          {
            title: "输入 / 输出 USD 每百万 token",
            width: 240,
            render: (_, r) =>
              `${money(r.priceInput)} / ${money(r.priceOutput)}`,
          },
          {
            title: "源站",
            width: 90,
            render: (_, r) => (
              <a href={r.url} target="_blank" rel="noreferrer">
                查看 <ExportOutlined aria-hidden="true" />
              </a>
            ),
          },
        ];
  return (
    <div className="min-w-0">
      <section className="ranking-intro rounded-[13px] border border-line bg-surface shadow-card">
        <div className="portal-section-heading">
          <div>
            <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
              BENCHMARK EXPLORER
            </span>
            <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
              融合排行榜与完整模型库
            </h2>
            <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
              综合能力不以成本披露为门槛。单榜视图保留每条源配置，便于回到原始证据。
            </p>
          </div>
          <Button
            icon={<DownloadOutlined aria-hidden="true" />}
            onClick={() =>
              onExport(
                view === "fusion"
                  ? csvExport(filtered, exportMeta)
                  : nativeCsvExport(filtered, {
                      fetchedAt: sources?.[view]?.fetchedAt,
                      sourceDate: sources?.[view]?.sourceDate,
                    }),
                view === "fusion" ? "model-ranking.csv" : `${view}-ranking.csv`,
              )
            }
          >
            导出当前榜单
          </Button>
        </div>
        <Segmented
          block
          aria-label="排行榜来源"
          value={view}
          onChange={(v) => onRanking({ view: v, creator: undefined })}
          options={[
            { value: "fusion", label: "融合总榜" },
            ...SOURCE_IDS.map((value) => ({ value, label: NAMES[value] })),
          ]}
        />
        <SourceQuality compact sources={sources} />
        <QualityNote />
      </section>
      <div
        className={
          "mb-[22px] grid items-start gap-[19px] max-1180:gap-[16px] max-760:flex max-760:flex-col max-760:gap-[16px] " +
          (view !== "fusion"
            ? "grid-cols-[minmax(0,1fr)]"
            : "grid-cols-[235px_minmax(0,1fr)] max-1180:grid-cols-[215px_minmax(0,1fr)]")
        }
      >
        {view === "fusion" && controls}
        <section className="ranking-table rounded-[13px] border border-line bg-surface shadow-card">
          <CreatorChips
            chips={chips}
            creator={creator}
            onChange={(value) => onRanking({ creator: value })}
            className="px-[21px] pt-[20px] pb-[10px] max-760:px-[15px]"
          />
          <div className="ranking-filters flex flex-wrap items-center gap-[10px] px-[21px] pt-[10px] pb-[12px] max-760:gap-[9px] max-760:px-[15px] max-760:pt-[13px]">
            <Input
              aria-label="排行榜搜索"
              prefix={<SearchOutlined aria-hidden="true" />}
              value={query}
              onChange={(e) => onRanking({ query: e.target.value })}
              placeholder="搜索模型、配置或厂商"
              allowClear
            />
            <Select
              virtual={false}
              aria-label="排行榜开放状态"
              value={openness}
              onChange={(v) => onRanking({ openness: v })}
              options={[
                { value: "all", label: "全部开放状态" },
                { value: "open", label: "开放权重" },
                { value: "closed", label: "闭源" },
                { value: "unknown", label: "未确认" },
              ]}
            />
            <Select
              virtual={false}
              aria-label="排行榜厂商"
              allowClear
              placeholder="全部厂商"
              value={creator}
              onChange={(v) => onRanking({ creator: v })}
              options={[...new Set(pool.map((r) => r.creator).filter(Boolean))]
                .sort()
                .map((value) => ({ value, label: value }))}
            />
            {view === "fusion" ? (
              <>
                <Checkbox
                  checked={scoredOnly}
                  onChange={(e) => onRanking({ scoredOnly: e.target.checked })}
                >
                  仅看有效综合分
                </Checkbox>
                <Checkbox
                  checked={showSuites}
                  onChange={(e) => onRanking({ showSuites: e.target.checked })}
                >
                  LiveBench 能力维度
                </Checkbox>
              </>
            ) : (
              <>
                <Checkbox
                  checked={nativeEstimates}
                  onChange={(e) =>
                    onRanking({ nativeEstimates: e.target.checked })
                  }
                >
                  包含估算配置
                </Checkbox>
                <Checkbox
                  checked={nativeHistorical}
                  onChange={(e) =>
                    onRanking({ nativeHistorical: e.target.checked })
                  }
                >
                  包含历史配置
                </Checkbox>
              </>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-[8px] px-[21px] pb-[16px] text-[10px] leading-[1.8] text-[#627b89] max-760:px-[15px] max-760:pb-[14px]">
            <span>
              {filtered.length} 条{view === "fusion" ? "模型族" : "源配置"} ·
              名次基于筛选前的{view === "fusion" ? "综合评分" : "单榜样本"}
              ，筛选不重算
            </span>
            {budgetNote && view === "fusion" && (
              <span className="budget-note">
                预算筛选隐藏 {budgetNote.hidden} 个模型族（{budgetNote.missing}{" "}
                个未披露或不可核对该来源成本）
                {budgetExcluded
                  ? "；该来源当前被质量排除，暂无可核对的真实成本"
                  : ""}
              </span>
            )}
            {view === "fusion" && <span>勾选 2–4 个模型加入对比</span>}
          </div>
          {view === "fusion" && (
            <Alert
              className="ranking-alert"
              type="info"
              showIcon
              title="至少两榜参赛；每对共同有效榜单不足两个不比赛。不同模型的实际对手集合可能不同，请结合战绩与对手数阅读。"
            />
          )}
          {view !== "fusion" && (
            <p className="mt-[8px] mb-0 px-[21px] pt-0 pb-[18px] text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
              {NAMES[view]}{" "}
              {view === "arena"
                ? "文本总榜原始偏好评分；票数、区间与发布日期直接来自源站，不是融合置信度。该来源不提供任务成本。"
                : "的原始总分与原生任务成本。不同任务协议和推理配置不能视为统一实验。"}
            </p>
          )}
          <Table
            className="ranking-main-table"
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            size="middle"
            scroll={{
              x: view === "fusion" ? (suiteKeys.length ? 2180 : 1520) : 1120,
            }}
            rowSelection={
              view === "fusion"
                ? {
                    hideSelectAll: true,
                    selectedRowKeys: selection,
                    preserveSelectedRowKeys: true,
                    onChange: onSelectionChange,
                    getCheckboxProps: (r) => ({
                      disabled:
                        selection.length >= 4 && !selection.includes(r.id),
                    }),
                  }
                : undefined
            }
            pagination={{
              defaultPageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (n) => `${n} 条记录`,
            }}
          />
          <p className="mt-[8px] mb-0 px-[21px] pt-0 pb-[18px] text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
            {view === "fusion"
              ? "多数对决积分：至少两榜准入，主积分相同才用辅助分排序；对手集合可能不同，请结合实际对手数阅读。辅助分不参与帕累托判断，多数关系可能循环。"
              : "源站名次由当前纳入配置按原始总分计算，并列同名次；不复刻源站的置信区间排名。"}
          </p>
        </section>
      </div>
    </div>
  );
}

const SUITES = {
  design_layout: "设计与布局",
  research: "研究",
  browser: "浏览器任务",
  coding: "编程",
  long_horizon: "长程任务",
  data_analysis: "数据分析",
  reasoning: "推理",
};
export function Comparison({
  models,
  analysis,
  selection,
  onSelectionChange,
  onSelect,
  costSource,
  onNavigate,
  sources,
}) {
  const selected = useMemo(
    () =>
      selection
        .map((id) => analysis.rows.find((r) => r.id === id))
        .filter(Boolean),
    [selection, analysis.rows],
  );
  const matches = selected.flatMap((left, i) =>
    selected.slice(i + 1).map((right) => ({
      id: `${left.id}:${right.id}`,
      left,
      right,
      ...majorityMatch(left, right, {
        includeEstimated: analysis.includeEstimated,
      }),
    })),
  );
  const columns = [
    { title: "指标 / 来源", dataIndex: "label", fixed: "left", width: 185 },
    ...selected.map((r) => ({
      title: (
        <button className="model-link" onClick={() => onSelect(r.id)}>
          {r.name}
        </button>
      ),
      key: r.id,
      width: 235,
      render: (_, metric) => metric.values[r.id],
    })),
  ];
  const metric = (key, label, get) => ({
    key,
    label,
    values: Object.fromEntries(selected.map((r) => [r.id, get(r)])),
  });
  const facts = [
    metric("creator", "厂商", (r) => r.creator),
    metric("openness", "开放状态", stateTag),
    metric("composite", "多数对决积分", (r) => number(r.composite)),
    ...[
      metric("record", "对决战绩（胜 / 平 / 负）", (r) =>
        r.record && r.composite != null
          ? `${r.record.wins} / ${r.record.draws} / ${r.record.losses}（${r.record.opponents} 个对手）`
          : "未参加正式排名",
      ),
    ],
    ...[
      metric("auxiliary", "同积分辅助分（仅用于排序）", (r) =>
        number(r.auxiliary),
      ),
    ],
    metric(
      "coverage",
      "有效评分覆盖",
      (r) =>
        `${r.available.length}/${analysis.sources.length} 榜${r.complete ? "" : " · 部分覆盖"}`,
    ),
    metric("cost", COSTS[costSource], (r) => costFormat(r.cost, costSource)),
    ...SOURCE_IDS.flatMap((s) => [
      metric(s + "score", `${NAMES[s]} · 原始分`, (r) =>
        number(r.representatives[s]?.score),
      ),
      metric(s + "percentile", `${NAMES[s]} · 排名分`, (r) =>
        r.percentiles[s] == null ? "未参与评分" : number(r.percentiles[s]),
      ),
      metric(s + "cost", `${NAMES[s]} · USD/任务`, (r) =>
        money(r.representatives[s]?.costTask),
      ),
      metric(s + "config", `${NAMES[s]} · 配置`, (r) => (
        <span className="text-[11px] leading-[1.8] text-[#5e7783] [overflow-wrap:anywhere]">
          {r.representatives[s]?.configuration ?? "未覆盖"}
          {r.representatives[s]?.estimated && <Tag color="orange">估算</Tag>}
          {r.representatives[s]?.deprecated && <Tag>历史</Tag>}
        </span>
      )),
    ]),
    metric(
      "arena-votes",
      "Arena · 投票数",
      (r) => r.representatives.arena?.voteCount ?? "未披露",
    ),
    metric("arena-interval", "Arena · 源站评分区间", (r) => {
      const a = r.representatives.arena;
      return a ? `${number(a.scoreLower)} – ${number(a.scoreUpper)}` : "未披露";
    }),
    metric(
      "arena-date",
      "Arena · 榜单发布日期",
      (r) => r.representatives.arena?.publishedAt ?? "未披露",
    ),
    metric("input", "AA · 输入 USD/百万 token", (r) =>
      money(r.representatives.aa?.priceInput),
    ),
    metric("output", "AA · 输出 USD/百万 token", (r) =>
      money(r.representatives.aa?.priceOutput),
    ),
    metric("speed", "AA · 输出速度 token/s", (r) =>
      number(r.representatives.aa?.speed),
    ),
    metric("latency", "AA · 首 token 延迟秒", (r) =>
      number(r.representatives.aa?.latency),
    ),
  ];
  const suites = [
    ...new Set(
      selected.flatMap((r) =>
        Object.keys(r.representatives.livebench?.suites ?? {}),
      ),
    ),
  ];
  return (
    <div className="min-w-0">
      <section className="compare-selector rounded-[13px] border border-line bg-surface shadow-card">
        <div className="portal-section-heading">
          <div>
            <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86] max-760:text-[8px]">
              SIDE BY SIDE
            </span>
            <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
              模型对比
            </h2>
            <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
              保留各站的独立任务与计价口径；最多选择 4
              个模型，选择会保存在本机。
            </p>
          </div>
          <Button
            onClick={() => onSelectionChange([])}
            disabled={!selection.length}
          >
            清空对比
          </Button>
        </div>
        <Select
          mode="multiple"
          maxCount={4}
          showSearch
          optionFilterProp="label"
          virtual={false}
          aria-label="选择对比模型"
          placeholder="搜索并选择 2–4 个模型"
          value={selection}
          onChange={onSelectionChange}
          options={models.map((m) => ({
            value: m.id,
            label: `${m.name} · ${m.creator}`,
          }))}
        />
      </section>
      {selected.length < 2 ? (
        <section className="mb-[20px] rounded-[13px] border border-line bg-surface px-[20px] py-[65px] shadow-card">
          <Empty
            description={
              selected.length
                ? "再选择一个模型开始对比"
                : "从排行榜勾选模型，或在上方搜索添加"
            }
          >
            <Button type="primary" onClick={() => onNavigate("rankings")}>
              去排行榜选模型
            </Button>
          </Empty>
        </section>
      ) : (
        <>
          <section className="mb-[20px] rounded-[13px] border border-line bg-surface px-[25px] py-[23px] shadow-card max-760:px-[16px] max-760:py-[20px]">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  配置一致性与数据提示
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  先核对每个模型在不同源站的配置，再阅读综合结果。已排除的来源不参与下方评分与成本计算，原始配置仍可在详情与单榜中查看。
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-[15px] max-1000:grid-cols-1">
              {selected.map((r) => (
                <div key={r.id}>
                  <ConfigurationDetails model={r} />
                  <EvidenceBadges model={r} sources={sources} />
                </div>
              ))}
            </div>
            <SourceQuality sources={sources} />
            <QualityNote />
          </section>
          <section className="mb-[20px] rounded-[13px] border border-line bg-surface p-[25px] shadow-card max-760:px-[16px] max-760:py-[20px]">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  各榜排名分对比
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  0–100
                  为当前评分样本内的相对位置，越高越靠前。缺分或未启用的榜单不画条形。
                </p>
              </div>
              <Tag>同一综合评分样本</Tag>
            </div>
            <CompareChart rows={selected} />
            <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
              原始分量纲不同，因此图中只比较各榜相对位置；下表完整保留原始分。多数对决主积分使用逐榜胜负；仅在主积分相同时使用这些排名分的等权平均辅助排序；不足当前覆盖门槛的模型不参加正式排名。
            </p>
          </section>
          {
            <section className="majority-comparison mb-[20px] rounded-[13px] border border-line bg-surface p-[20px] shadow-card">
              <h2 className="text-[17px]">两两对决与原始分差</h2>
              <p className="text-[11px] leading-[1.9] text-[#627987]">
                每榜各一票。下表每行以左侧模型为参照，分差只在同一榜内计算，不跨榜相加，也不混入积分。共同有效榜单不足{" "}
                {analysis.required} 个不判胜负。
              </p>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 1000 }}
                dataSource={matches}
                columns={[
                  {
                    title: "对阵（左 / 右）",
                    width: 200,
                    render: (_, r) => `${r.left.name} / ${r.right.name}`,
                  },
                  ...SOURCE_IDS.map((source) => ({
                    title: NAMES[source],
                    width: 200,
                    render: (_, r) => {
                      const ballot = r.ballots.find((b) => b.source === source);
                      return (
                        <span>
                          {number(r.left.representatives[source]?.score)} /{" "}
                          {number(r.right.representatives[source]?.score)}
                          <br />
                          {ballot.vote === null
                            ? "未计票"
                            : `差 ${ballot.difference > 0 ? "+" : ""}${number(ballot.difference)} · ${ballot.vote > 0 ? "左胜" : ballot.vote < 0 ? "右胜" : "平票"}`}
                        </span>
                      );
                    },
                  })),
                  {
                    title: "票数与结果",
                    width: 180,
                    render: (_, r) =>
                      !r.complete
                        ? "共同有效榜单不足，不判胜负"
                        : `${r.leftWins}∶${r.rightWins}（${r.tied} 平票）· ${r.result > 0 ? "左方获胜" : r.result < 0 ? "右方获胜" : "对决平局"}`,
                  },
                ]}
              />
            </section>
          }
          <section className="compare-facts rounded-[13px] border border-line bg-surface shadow-card">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  能力、成本与配置明细
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  不同源的美元任务成本分别展示；不相加，也不折算成统一生产账单。
                </p>
              </div>
            </div>
            <Table
              rowKey="key"
              columns={columns}
              dataSource={facts}
              pagination={false}
              size="middle"
              scroll={{ x: 185 + 235 * selected.length }}
            />
          </section>
          <section className="compare-facts rounded-[13px] border border-line bg-surface shadow-card">
            <div className="portal-section-heading">
              <div>
                <h2 className="mt-[5px] mb-0 flex items-center gap-[8px] text-[17px] font-semibold leading-[1.7] max-760:text-[16px]">
                  LiveBench 分类能力
                </h2>
                <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b] max-760:text-[11px]">
                  直接使用 LiveBench 各 suite
                  的原始分，不将分类能力外推到其他榜单。
                </p>
              </div>
            </div>
            {suites.length ? (
              <Table
                rowKey="key"
                columns={columns}
                dataSource={suites.map((s) =>
                  metric(s, SUITES[s] ?? s, (r) =>
                    number(r.representatives.livebench?.suites?.[s]),
                  ),
                )}
                pagination={false}
                scroll={{ x: 185 + 235 * selected.length }}
              />
            ) : (
              <Empty description="所选模型没有可用的 LiveBench 分类分" />
            )}
          </section>
        </>
      )}
    </div>
  );
}
