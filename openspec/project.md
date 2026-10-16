# 项目上下文（openspec/project.md）

供规格与变更工作使用的项目事实，详细背景见根目录 `README.md`、`CONSTITUTION.md` 与 `docs/adr/`。

## 技术栈与架构

- React 19 + antd 6 + ECharts 6，Vite 8 打包；Node 22.12+ 原生 `node:http` 单服务（无后端框架），端口 4317，仅监听 127.0.0.1。
- 数据：三站（Artificial Analysis / Vals / LiveBench）后台 HTTP 抓取 → `data/snapshot.json`（含失败回退、刷新锁）。
- 纯函数层（`src/analysis.mjs`、`src/share.mjs`、`src/portal.mjs`、`server/adapters.mjs` 等）与 UI 分离，可直接被 node:test 导入测试。

## 约定

- 简体中文注释与文档；`node --test` 单测；Playwright E2E 共三套。
- 量化口径是公共契约（ADR-0003），改口径先改 ADR。
- 完整口径经 URL hash 编解码（ADR-0002），改动契约必须同步 `tests/share.test.mjs` 往返测试。

## 已知约束

- 诚实性红线（CONSTITUTION.md）：解析失败必须显式报错，禁止静默编造。
- 显示筛选不得影响分数、名次、前沿。
