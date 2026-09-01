# TASK-0223：共享 IndexedDB 层补直接单测

- 状态：已完成
- 负责人：Claude
- 创建日期：2026-09-01
- 更新日期：2026-09-01
- 关联需求：无（补测，不改产品行为）
- 关联决策：ADR-0001
- 关联任务：TASK-0222（本任务闭合其交接中记录的风险项）

## 目标

TASK-0222 抽出的 `web/app/local-idb.ts` 只被两个调用方的测试间接覆盖，而那两个测试
的 fake 只走成功路径。共享层真正没有覆盖的是错误分支——`onerror`、`onabort`、
`onblocked`、错误对象缺失时的兜底，以及 `openLocalIdb` 与 `openLocalIdbOrNull` 的
语义差异。本任务为共享层补直接单测，覆盖这些分支。

## 范围

### 包含

- 新增 `web/app/local-idb.test.ts`，覆盖 5 个导出的成功与失败分支。
- 变异测试验证新断言确有检出能力（非仅追求绿灯）。
- 更新 TASK-0222 交接中的风险项状态。

### 不包含

- 不改动 `local-idb.ts` 的实现。补测的前提是当前行为正确，本任务不顺手改行为。
- 不改动两个调用方及其测试。
- 不引入 fake-indexeddb 等第三方桩库；仓库既有做法是手写桩，沿用之。

## 必读上下文

- `web/app/local-idb.ts`
- `web/app/use-local-recording-storage.test.ts`（既有手写桩的写法基准）
- `docs/tasks/completed/0222-local-idb-shared-layer.md`

## 约束与假设

- 约束：桩的写法需与既有测试一致（`Object.defineProperty` 替换 `window.indexedDB`，
  `queueMicrotask` 派发事件），不引入新范式。
- 约束：既有 291 passed 基线不得下降。
- 假设：`openLocalIdbOrNull` 与 `openLocalIdb` 在失败时表现必须不同，这是 0222 的
  核心取舍，需由测试锁死以防后续被"简化"掉。

## 计划

- [x] 读既有测试，确认手写桩的写法基准。
- [x] 按结局分别构造桩，覆盖成功、error、abort、blocked 与错误对象缺失。
- [x] 覆盖两个开库入口的语义差异。
- [x] 变异测试验证断言的检出能力。
- [x] 跑 lint 与全量 check。
- [x] 建立任务记录、更新 0222 风险项并提交。

## 验收标准

- [x] `local-idb.ts` 的 5 个导出均有直接测试。
- [x] `onerror`、`onabort`、`onblocked` 与错误兜底分支均被覆盖。
- [x] 两个开库入口的失败语义差异被测试锁死。
- [x] 每组断言经变异测试证明可检出对应缺陷。
- [x] lint 通过（0 error 0 warning），全量 check 通过。
- [x] 本次改动已单独提交。

## 工作记录

- 2026-09-01：先看既有测试的桩写法。其 fake 只走成功路径，所以间接覆盖到不了错误
  分支——这正是补直接单测的价值所在，而非重复已有覆盖。
- 2026-09-01：桩按结局拆开构造（`successRequest` / `failingRequest` /
  `transactionStub(outcome)` / `StubFactory(outcome)`），而不是做一个可配置的大 fake。
  每个测试只关心一个结局，拆开后读起来更直接。
- 2026-09-01：绿灯本身不证明测试有效。用 4 个变异验证：吞掉 `onabort`、把
  `onblocked` 当作不支持、让 `openLocalIdbOrNull` 直接转发、跳过 `contains` 检查。
  4 个全部被捕获，其中"直接转发"恰好打挂 `openLocalIdbOrNull` 的 2 条断言，说明
  0222 的取舍已被锁死。
- 2026-09-01：首轮 lint 报 `beforeEach` 导入未使用。每个测试各自装桩，确实不需要统一
  前置，删掉导入而非补一个空的 `beforeEach`。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 新增测试单独运行 | `npx vitest run app/local-idb.test.ts` | 19 passed | 2026-09-01 |
| 变异 1：`onabort` 改 resolve | 植入后运行新测试 | 1 failed，被捕获 | 2026-09-01 |
| 变异 2：`onblocked` 改 resolve(null) | 植入后运行新测试 | 1 failed，被捕获 | 2026-09-01 |
| 变异 3：`openLocalIdbOrNull` 直接转发 | 植入后运行新测试 | 2 failed，被捕获 | 2026-09-01 |
| 变异 4：跳过 `contains` 检查 | 植入后运行新测试 | 1 failed，被捕获 | 2026-09-01 |
| 源文件已还原 | `diff` 对比备份 | 一致，19 passed | 2026-09-01 |
| 全量测试 | `npm run check` | 310 passed (7 files)，较基线 +19 | 2026-09-01 |
| lint | `npm run lint` | 0 error 0 warning | 2026-09-01 |
| 构建 | `npm run check`（含 build） | 5 个环境全部通过 | 2026-09-01 |
| 工作区状态 | `git status --short` | 仅预期的 1 增 1 改 | 2026-09-01 |

## 交接

- 当前状态：已完成并已提交。仅新增测试与文档，产品代码未动。
- 改动范围：新增 `web/app/local-idb.test.ts`；修改
  `docs/tasks/completed/0222-local-idb-shared-layer.md` 的风险项；本任务文档。
- 风险与未决问题：无。
- 下一步：无必须后续项。若后续修改 `local-idb.ts` 的错误处理，本测试会直接报错，
  应视为行为变更信号而非测试过时。
