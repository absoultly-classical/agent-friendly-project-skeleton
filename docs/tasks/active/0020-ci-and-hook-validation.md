# TASK-0020：CI 与本地钩子验证

- 状态：已完成
- 负责人：Agent
- 创建日期：2026-09-02
- 更新日期：2026-09-02
- 关联需求：无（基础设施验收）
- 关联决策：无

## 目标

验证 GitHub Actions CI 和本地 pre-commit 钩子能正确执行 lint + check 门禁，确保
`AGENTS.md` 第 49-66 行约定的提交纪律有机械保障。

## 范围

### 包含

- 启用本地 Git 钩子（`git config core.hooksPath .githooks`）。
- 触发一次真实的 GitHub Actions CI 运行并确认通过。
- 将 eslint 规则 `no-unused-vars` 从 warn 提升至 error，验证钩子能拦截不合规代码。

### 不包含

- ICE 候选刷新和随机点名文案中 42 vs 5 两处差异的口径决策（需要用户确认）。
- 新增功能或业务逻辑改动。

## 必读上下文

- [`AGENTS.md`](../../AGENTS.md) 第 49-66 行：提交与测试约定。
- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)：CI 流程定义。
- [`.githooks/pre-commit`](../../../.githooks/pre-commit)：本地提交门禁脚本。
- [`docs/development.md`](../../development.md)：开发约定与门禁自动化。

## 约束与假设

- **约束**：CI 在每次 push 和 PR 上运行，执行 `npm run lint` 和 `npm run check`。
- **约束**：本地钩子需要 `git config core.hooksPath .githooks` 启用一次。
- **假设**：当前 main 分支代码已通过所有测试（验证：运行 `npm run check`）。

## 计划

- [x] 启用本地 Git 钩子。
- [x] 提升 eslint 规则严格度，验证钩子能拦截不合规提交。
- [x] 推送到 GitHub 触发 CI，确认远程门禁通过。

## 验收标准

- [x] 本地钩子已启用，提交时自动执行 lint + check。
- [x] GitHub Actions CI 成功运行并通过。
- [x] eslint `no-unused-vars` 规则从 warn 提升至 error，钩子能拦截违规代码。

## 工作记录

**2026-09-02**
- 执行 `git config core.hooksPath .githooks` 启用本地钩子。
- 将 `web/eslint.config.mjs` 中 `no-unused-vars` 从 warn 改为 error，验证钩子门禁生效。
- 提交 `f15ff96`，推送到 main 分支。
- GitHub Actions CI 运行 #33586554743 成功通过（328 tests passed，生产构建成功）。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 本地 pre-commit 钩子 | 提交时自动触发 lint + check | 通过（328 tests passed） | 2026-09-02 |
| GitHub Actions CI | push 触发 run #33586554743 | success | 2026-09-02 |
| eslint 规则强化 | no-unused-vars warn → error | 钩子能正确拦截违规代码 | 2026-09-02 |

## 交接

- **当前状态**：CI 和本地钩子验证完成，门禁机制正常工作。所有改动已提交并推送。
- **改动范围**：
  - `web/eslint.config.mjs`：no-unused-vars 规则强化。
  - Git 配置：`core.hooksPath=.githooks`（本地环境）。
- **风险与未决问题**：
  - ICE 候选刷新文案"42 个 ICE 候选"与实际刷新 5 个的差异未定口径（需用户确认）。
  - 随机点名时是否也应与上述口径一致（需用户确认）。
- **下一步**：
  - 若用户确认文案口径，更新对应 UI 文案并补充测试。
  - 若有新功能需求，从 `docs/tasks/TEMPLATE.md` 创建新任务并登记到 `ACTIVE.md`。
