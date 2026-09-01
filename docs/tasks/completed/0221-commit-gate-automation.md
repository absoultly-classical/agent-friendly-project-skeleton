# TASK-0221：提交与测试纪律的机械门禁

- 状态：已完成
- 负责人：Claude
- 创建日期：2026-09-01
- 更新日期：2026-09-01
- 关联需求：无（协作流程自动化）
- 关联决策：ADR-0001
- 关联任务：TASK-0220（本任务闭合其“风险与未决问题”）

## 目标

TASK-0220 把提交粒度与测试门槛写成了规则，但只靠执行者自觉。本任务为这两条纪律
加机械门禁：远端 CI 对每次 push 与 pull request 强制执行，本地 pre-commit 钩子在提交
前执行同样检查，使违规提交无法静默通过。

## 范围

### 包含

- 新增 `.github/workflows/ci.yml`：push 与 pull request 触发，执行 `npm run lint`
  与 `npm run check`。
- 新增 `.githooks/pre-commit`：仅在暂存区含 `web/` 改动时执行同样两步。
- 在 `docs/development.md` 新增“门禁自动化”章节，说明启用方式与设计取舍。
- 在 `AGENTS.md` 的提交与测试章节指向门禁，并禁止绕过。

### 不包含

- 不改动 `web/` 代码与测试实现。
- 不自动改写使用者的 Git 配置（`core.hooksPath` 由使用者显式启用一次）。
- 不引入覆盖率门禁或其他新增检查项，只固化现有 `lint` 与 `check`。

## 必读上下文

- `AGENTS.md`、`docs/development.md`
- `docs/tasks/completed/0220-commit-and-test-discipline.md`
- `web/package.json`（`scripts`、`engines`）

## 约束与假设

- 约束：门禁执行的命令必须与 `web/package.json` 现有脚本一致，不新造命令。
- 约束：CI 的 Node 版本须满足 `engines: node >=22.13.0`。采用 `node-version: "22"`
  跟随主线，而非钉死在下限，以贴近本地实际验证环境（v22.22.2）。
- 约束：纯文档提交不应被 Web 门禁拖慢，故钩子按暂存区路径判定是否执行。
- 假设：Git 不随克隆自动启用钩子，因此本地门禁是选择启用；远端 CI 不依赖本地是否
  启用，始终生效。

## 计划

- [x] 新增 CI 工作流。
- [x] 新增 pre-commit 钩子并赋可执行位。
- [x] 同步 `docs/development.md` 与 `AGENTS.md`。
- [x] 实测钩子的跳过、通过、拦截三条路径。
- [x] 建立任务记录并提交改动。

## 验收标准

- [x] CI 在 push 与 pull request 上执行 lint 与完整检查。
- [x] 钩子在无 `web/` 改动时跳过，退出码 0。
- [x] 钩子在有 `web/` 改动且检查通过时放行，退出码 0。
- [x] 检查失败时钩子退出码非 0，提交被拦截。
- [x] 钩子以 `100755` 模式入库，克隆后可直接执行。
- [x] 缺少 `web/node_modules` 时钩子给出提示并中止，而非静默跳过。
- [x] 本次改动已单独提交。

## 工作记录

- 2026-09-01：先测全量 `npm run check` 耗时约 29–32s，据此判断把完整检查放进
  pre-commit 是可接受的，无需降级为仅跑 lint 或子集测试。
- 2026-09-01：CI 的 Node 版本初写为 `22.13.0`（`engines` 下限），随后改为 `"22"`。
  钉死下限会让 CI 与本地实际验证环境（v22.22.2）不一致，失败与通过都不可类推。
- 2026-09-01：钩子按暂存区判定而非无条件执行，避免纯文档提交承担 ~50s 开销。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 测试基线 | `npm run test` | 291 passed (6 files) | 2026-09-01 |
| 全量检查耗时与结果 | `npm run check` | 通过，约 29s | 2026-09-01 |
| 钩子跳过路径（仅暂存文档） | 运行 `.githooks/pre-commit` | 提示跳过，exit=0 | 2026-09-01 |
| 钩子通过路径（暂存 `web/` 改动） | 运行 `.githooks/pre-commit` | 全部通过，exit=0，52s | 2026-09-01 |
| 钩子拦截路径（植入必失败测试） | 运行 `.githooks/pre-commit` | 291 passed/1 failed，提示中止，exit=1 | 2026-09-01 |
| 钩子缺依赖路径（临时移走 `node_modules`） | 运行 `.githooks/pre-commit` | 提示执行 `npm ci` 并中止，exit=1 | 2026-09-01 |
| 钩子可执行位 | `git ls-files -s` | `100755` | 2026-09-01 |
| 探针文件无残留、工作区干净 | `git status --porcelain` | 仅预期改动 | 2026-09-01 |
| diff 格式检查 | `git diff --cached --check` | 通过 | 2026-09-01 |

## 交接

- 当前状态：已完成并已提交，未触及 `web/` 代码与测试。
- 改动范围：`.github/workflows/ci.yml`、`.githooks/pre-commit`、`AGENTS.md`、
  `docs/development.md`、本任务文档。
- 风险与未决问题：CI 工作流未在真实 GitHub Actions 上跑过（本地无法触发），首次
  push 后需确认一次实际运行结果。本地钩子需每位使用者执行
  `git config core.hooksPath .githooks` 启用；未启用者仍受 CI 约束。
- 下一步：首次 push 后核对 Actions 运行状态；若将来新增检查项，同步更新 CI 与钩子
  两处，避免二者漂移。
