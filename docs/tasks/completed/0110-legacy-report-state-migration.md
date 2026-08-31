# 0110：旧本机报告状态兼容

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-006、REQ-012
- 关联决策：无

## 目标

让缺少新版 `reportGenerated` 字段的旧本机会议记录继续保持原有报告生成语义。

## 范围

### 包含

- 读取旧记录时从 `generateReport` 推导缺失的报告生成状态。
- 保留新版显式 `reportGenerated` 字段的优先级。
- 补充旧记录恢复测试并更新架构说明。

### 不包含

- 不迁移或重写用户的历史 localStorage 数据。
- 不改变服务端报告能力和当前本地原型边界。

## 计划

- [x] 审计新版字段加入前的本机记录兼容行为。
- [x] 从旧自动报告选项推导缺失状态并补测试。
- [x] 运行完整门禁、归档记录并继续下一轮审计。

## 验收标准

- [x] 旧记录明确关闭自动报告且缺少新字段时，历史报告仍显示“立即生成报告”。
- [x] 旧记录默认/开启自动报告时，不改变既有已生成语义。
- [x] 全量测试、类型检查、构建、Lint、diff 和 HTTP 检查通过。

## 工作记录

- 2026-08-30：审计发现 `reportGenerated` 缺失时固定回退为 true，无法保留旧记录的 `generateReport: false`。
- 2026-08-30：读取记录先归一化 `generateReport`，再用它推导缺失的 `reportGenerated`；显式新字段仍优先。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 页面回归 | `npm test -- app/page.test.tsx` | 110 项通过 | 2026-08-30 |
| 完整 Web 门禁 | `npm run check` | 2 个测试文件、140 项通过，typecheck/build 通过 | 2026-08-30 |
| 代码质量 | `npm run lint`、`git diff --check` | 通过；diff check 仅有换行符提示 | 2026-08-30 |
| 本地服务 | `Invoke-WebRequest -UseBasicParsing http://localhost:3000/` | HTTP 200 | 2026-08-30 |

## 交接

- 当前状态：已完成实现和验证，任务已归档。
- 改动范围：`web/app/page.tsx`、`web/app/page.test.tsx`、`docs/architecture/overview.md`。
- 风险与未决问题：旧记录只在读取时归一化，不会自动写回或修复原始 localStorage。
- 下一步：继续审计报告分享/回放和本地 WebRTC 生命周期。
