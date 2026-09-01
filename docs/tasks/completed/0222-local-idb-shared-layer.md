# TASK-0222：IndexedDB 下层封装去重

- 状态：已完成
- 负责人：Claude
- 创建日期：2026-09-01
- 更新日期：2026-09-01
- 关联需求：无（内部重构，不改变外部行为）
- 关联决策：ADR-0001
- 关联任务：无

## 目标

`use-local-material-contents.ts` 与 `use-local-recording-storage.ts` 各自实现了一份
完全等价的 IndexedDB 下层：`requestResult` 与 `transactionResult` 逐字符相同，可用性
探测仅函数名不同（`isIndexedDbAvailable` / `canUseIndexedDb`），`openDatabase` 只在库名、
仓库名与 `keyPath` 上有差异。本任务把这层抽到共享模块，使事件桥接逻辑只有一份实现。

## 范围

### 包含

- 新增 `web/app/local-idb.ts`：导出 `isIndexedDbAvailable`、`requestResult`、
  `transactionResult`、`openLocalIdb`、`openLocalIdbOrNull` 与 `LocalIdbConfig`。
- 两个存储模块改为从共享模块导入，各自只保留库配置常量与领域逻辑。
- 录制模块内 `canUseIndexedDb` 的 4 处调用改名为 `isIndexedDbAvailable`。

### 不包含

- 不改动任何外部导出的函数签名与返回值语义。
- 不改动测试文件（测试打的是 `window.indexedDB`，不触碰内部函数）。
- 不引入 `idb` 等第三方库；现有封装已够用，加依赖不划算。
- 不合并两个库的 schema：素材与录制是独立库，各有独立版本号与生命周期。

## 必读上下文

- `web/app/use-local-material-contents.ts`、`web/app/use-local-recording-storage.ts`
- 对应的两个 `.test.ts`（确认其不 mock 内部实现，故可作回归检测装置）

## 约束与假设

- 约束：两个调用方对开库失败的语义不同——素材侧需区分 `failed`（开库抛错）与
  `unsupported`（环境不支持），录制侧两者都归 `false`。因此共享层提供两个入口：
  `openLocalIdb` 抛错向上传递，`openLocalIdbOrNull` 吞掉异常返回 `null`。
- 约束：重构不得改变测试数量与结果，291 passed 是判定依据。
- 假设：`pruneLocal*` 中在同一事务内 `await` IDB 请求是规范允许的（微任务内事务仍
  活跃），此前挂起的疑点经复核不成立，不作改动。

## 计划

- [x] 复核 `pruneLocalMaterialContents` 的事务疑点，确认非缺陷。
- [x] 确认两个测试文件不 mock 内部函数，重构可用既有测试兜底。
- [x] 新增 `local-idb.ts` 共享模块。
- [x] 两个存储模块接入共享模块并删除本地副本。
- [x] 统一 `canUseIndexedDb` 命名。
- [x] 跑 lint 与全量 check，核对测试基线未变。
- [x] 建立任务记录并提交改动。

## 验收标准

- [x] `requestResult`、`transactionResult`、`indexedDB.open` 的定义只存在于
      `local-idb.ts` 一处。
- [x] 两个存储模块的外部导出签名与返回值语义未变。
- [x] 测试数量与结果与重构前一致（291 passed / 6 files）。
- [x] lint 通过，构建通过。
- [x] 本次改动已单独提交。

## 工作记录

- 2026-09-01：先复核此前挂起的 `pruneLocalMaterialContents` 事务疑点。`await` 的是
  同一事务内的 IDB 请求，微任务边界内事务未失活，属规范允许模式，不是缺陷，不改。
- 2026-09-01：抽取前先确认测试的耦合方式。两个测试文件只替换 `window.indexedDB`，
  不 mock 内部函数，因此既有测试能真实检出重构回归——这是敢动这层的前提。
- 2026-09-01：共享层做成两个开库入口而非一个。若强行统一为吞异常版本，素材侧就无法
  再区分 `failed` 与 `unsupported`，会静默改变对外语义。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 重构前测试基线 | `npm run check` | 291 passed (6 files) | 2026-09-01 |
| 重构后测试基线 | `npm run check` | 291 passed (6 files)，与重构前一致 | 2026-09-01 |
| lint | `npm run lint` | 通过，无告警 | 2026-09-01 |
| 构建 | `npm run check`（含 build） | 5 个环境全部构建通过 | 2026-09-01 |
| 重复定义已收敛 | `grep -ln` 扫 `web/app/*.ts{,x}` | 仅 `local-idb.ts` 命中 | 2026-09-01 |
| 行数变化 | `wc -l` | 两模块 326→258，新增共享层 66 | 2026-09-01 |
| 工作区状态 | `git status --short` | 仅预期的 2 改 1 增 | 2026-09-01 |

## 交接

- 当前状态：已完成并已提交。外部行为未变，属纯内部重构。
- 改动范围：新增 `web/app/local-idb.ts`；修改 `web/app/use-local-material-contents.ts`、
  `web/app/use-local-recording-storage.ts`；本任务文档。
- 风险与未决问题：已由 TASK-0223 闭合（当时缺的共享层直接单测已补齐）。
- 下一步：无必须后续项。新增本地存储模块时应直接复用 `local-idb.ts`，不要再复制
  事件桥接代码。
