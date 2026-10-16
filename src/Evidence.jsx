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
export function EvidenceBadges({ model, sources }) {
  const flags = evidenceFlags(model, sources);
  return (
    <div className="evidence-badges">
      <ConfigurationBadge model={model} />
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
      <div className="configuration-title">
        <b>{model.name}</b>
        <ConfigurationBadge model={model} />
      </div>
      <p>{assessment.reason}</p>
      <div className="configuration-entries">
        {assessment.entries.map((e) => (
          <div key={e.source}>
            <span>{NAMES[e.source]}</span>
            <b>{e.configuration || "未披露"}</b>
            <small>
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
            <div>
              <b>{name}</b>
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
            <dl>
              <dt>源站版本 / 更新标签</dt>
              <dd>{source?.sourceDate ?? "源站未披露"}</dd>
              <dt>最近成功获取</dt>
              <dd>{formatTime(source?.fetchedAt)}</dd>
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
    <section className="panel history-summary">
      <div className="portal-section-heading">
        <div>
          <span className="eyebrow">OBSERVED CHANGES</span>
          <h2>
            <HistoryOutlined aria-hidden="true" /> 真实变化记录
          </h2>
          <p>只记录本机实际观察到的源站变化，不将收录时间当作模型发布时间。</p>
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
        <div>
          <b>
            {history?.recordCount ?? 0}
            <small> / {history?.limit ?? 60} 份快照</small>
          </b>
          <span>最近归档：{formatTime(history?.lastRecordedAt)}</span>
        </div>
        <p>
          {!latest
            ? "尚未建立起始快照。"
            : latest.kind === "baseline"
              ? "已建立起始快照；尚无后续变化记录，不推断过去的涨跌。"
              : `最近一次变化：新增收录 ${latest.counts.added} 条、不再列出 ${latest.counts.removed} 条、指标或状态更新 ${latest.counts.updated} 条源配置。`}
        </p>
      </div>
      <p className="portal-footnote">
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
