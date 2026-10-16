import { Alert, Button, Tag, Tooltip } from "antd";
import {
  HistoryOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  configurationAssessment,
  evidenceFlags,
  sourceHealth,
} from "./evidence.mjs";
import { NAMES, formatTime } from "./presentation.mjs";
export function ConfigurationBadge({ model }) {
  const assessment = configurationAssessment(model);
  return (
    <Tooltip title={assessment.reason}>
      <Tag
        color={
          assessment.status === "different"
            ? "orange"
            : assessment.status === "matched"
              ? "blue"
              : "default"
        }
      >
        {assessment.label}
      </Tag>
    </Tooltip>
  );
}
// 列表 / 抽屉里的证据标签组：只渲染条件性数据提示（估算、历史配置、来源被排除或抓取失败）。
// 配置一致性徽标 98% 以上都是同一句「配置信息不足」，作为逐行标签是纯噪声，已下沉到
// ConfigurationDetails（模型详情与对比页「配置一致性与数据提示」），那里有逐源明细与原因。
export function EvidenceBadges({ model, sources }) {
  const flags = evidenceFlags(model, sources);
  if (!flags.length) return null;
  return (
    <div className="evidence-badges">
      {flags.map((f) => (
        <Tag key={f.key} color={f.color}>
          {f.label}
        </Tag>
      ))}
    </div>
  );
}
export function ConfigurationDetails({ model }) {
  const assessment = configurationAssessment(model);
  return (
    <section className="configuration-evidence">
      {/* configuration-title 类保留：残余规则 `.configuration-title .ant-tag` 仍以它为钩子 */}
      <div className="configuration-title flex flex-wrap items-center justify-between gap-[9px]">
        <b className="text-[12px] [overflow-wrap:anywhere]">{model.name}</b>
        <ConfigurationBadge model={model} />
      </div>
      <p className="my-[12px] text-[11px] leading-[1.9] text-[#617b88]">
        {assessment.reason}
      </p>
      <div className="grid gap-[10px]">
        {assessment.entries.map((e) => (
          <div
            key={e.source}
            className="min-w-0 border-t border-t-[#e9eff1] pt-[9px]"
          >
            <span className="mb-[5px] block text-[10px] text-[#627c88]">
              {NAMES[e.source]}
            </span>
            <b className="block text-[11px] font-medium text-[#345766] [overflow-wrap:anywhere]">
              {e.configuration || "未披露"}
            </b>
            <small className="mt-[5px] block text-[10px] text-[#6b8190]">
              {e.effort ? "effort: " + e.effort : "effort 未披露"}
              {e.mode ? " · " + e.mode : ""}
              {e.fallback ? " · 含 fallback" : ""}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
export function SourceQuality({ sources, compact = false }) {
  return (
    <div className={"source-quality-grid " + (compact ? "compact" : "")}>
      {Object.entries(NAMES).map(([s, name]) => {
        const source = sources?.[s];
        const health = sourceHealth(source);
        return (
          <div className="source-quality-card" key={s}>
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <b className="text-[11px] font-semibold">{name}</b>
              <Tag
                color={
                  health.failed || health.overdue
                    ? "orange"
                    : health.unknown
                      ? "default"
                      : "green"
                }
              >
                {health.failed
                  ? "失败回退"
                  : health.overdue
                    ? "超过24小时未获取"
                    : health.unknown
                      ? "尚无成功记录"
                      : "已成功获取"}
              </Tag>
            </div>
            <dl className="mt-[12px] mb-0 grid grid-cols-1 gap-[5px] text-[10px] leading-[1.8] max-760:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] max-760:gap-[7px_10px]">
              <dt className="text-[#6e8492]">源站版本 / 更新标签</dt>
              <dd className="m-0 mb-[4px] text-[#345967] [overflow-wrap:anywhere] max-760:m-0">
                {source?.sourceDate ?? "源站未披露"}
              </dd>
              <dt className="text-[#6e8492]">最近成功获取</dt>
              <dd className="m-0 mb-[4px] text-[#345967] [overflow-wrap:anywhere] max-760:m-0">
                {formatTime(source?.fetchedAt)}
              </dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}
export function HistorySummary({ history, onOpen }) {
  const latest = history?.latest;
  return (
    <section className="panel p-[23px_25px] my-[20px] max-760:p-[20px_16px]">
      {/* portal-section-heading 类保留：残余规则 `.portal-section-heading .ant-btn` 与 `h2 .anticon` 仍以它为钩子；
          h2 样式按原样留在 CSS（全局无分层 h2 规则会压过分层工具类，无法内联） */}
      <div className="portal-section-heading flex items-start justify-between gap-[18px] pb-[20px] max-1180:flex-wrap max-760:gap-[12px] max-760:pb-[14px]">
        <div>
          <span className="text-[9px] font-[650] tracking-[0.16em] text-[#668c86]">
            OBSERVED CHANGES
          </span>
          <h2>
            <HistoryOutlined aria-hidden="true" /> 真实变化记录
          </h2>
          <p className="mt-[6px] mb-0 text-[12px] leading-[1.9] text-[#657d8b]">
            只记录本机实际观察到的源站变化，不将收录时间当作模型发布时间。
          </p>
        </div>
        <Button
          icon={<HistoryOutlined aria-hidden="true" />}
          onClick={() => onOpen()}
        >
          查看更新记录
        </Button>
      </div>
      {history?.error && (
        <Alert type="warning" showIcon title={history.error} />
      )}
      <div className="history-summary-body">
        <div className="min-w-[180px]">
          <b className="text-[27px] font-semibold tabular-nums">
            {history?.recordCount ?? 0}
            <small className="text-[11px] font-normal text-[#627b88]">
              {" "}
              / {history?.limit ?? 60} 份快照
            </small>
          </b>
          <span className="mt-[8px] block text-[10px] leading-[1.8] text-[#627b88]">
            最近归档：{formatTime(history?.lastRecordedAt)}
          </span>
        </div>
        <p className="text-[12px] leading-[1.9] text-[#4e6f78] max-760:text-[11px]">
          {!latest
            ? "尚未建立起始快照。"
            : latest.kind === "baseline"
              ? "已建立起始快照；尚无后续变化记录，不推断过去的涨跌。"
              : `最近一次变化：新增收录 ${latest.counts.added} 条、不再列出 ${latest.counts.removed} 条、指标或状态更新 ${latest.counts.updated} 条源配置。`}
        </p>
      </div>
      <p className="mt-[16px] mb-0 text-[11px] leading-[1.9] text-[#627987] max-760:text-[10px]">
        <InfoCircleOutlined aria-hidden="true" />{" "}
        相同数据不重复归档；抓取失败沿用成功缓存，不计作删除。综合分受比较样本与设置影响，不作为历史能力涨跌依据。
      </p>
    </section>
  );
}
export function QualityNote() {
  return (
    <p className="evidence-explanation">
      <SafetyCertificateOutlined aria-hidden="true" />{" "}
      获取成功不代表评测版本很新。更新标签也不是每个模型的测试日期；未知信息不补值、不加分。
    </p>
  );
}
