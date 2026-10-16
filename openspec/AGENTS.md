# openspec 工作流（本仓库的轻量约定）

本项目采用 OpenSpec 的目录约定，但保持最小实现：没有 CLI、没有额外工具链。

## 目录

- `project.md`：项目上下文事实。
- `specs/<能力>/spec.md`：**当前**系统行为的规格（what is）。
- `changes/<变更名>/`：进行中的行为变更提案；完成后将其中规格并入 `specs/` 并删除该变更目录。

## 变更流程

1. 在 `changes/<变更名>/proposal.md` 写清：动机、涉及能力、行为前后差异。
2. 行为变更先判是否触及 ADR（量化口径、分享契约、架构）——触及则先改 `docs/adr/`。
3. 实现与测试一起交付；涉及规格的验收标准写成 spec 中的 Scenario。
4. 合入后把规格合并进 `specs/`，删除变更目录。

## 规格格式

每个能力一个 `spec.md`，按 `## ADDED Requirements`（或 `MODIFIED` / `REMOVED`）分节，需求用 `### Requirement: xxx`，下挂 `#### Scenario:` 列表。保持简短，只写可验证的行为。
