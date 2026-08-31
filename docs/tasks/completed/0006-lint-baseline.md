# 0006：前端 lint 基线治理

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-28
- 更新日期：2026-08-28
- 关联需求：REQ-003、REQ-007、REQ-013 至 REQ-019
- 关联决策：ADR-0001

## 目标

清理现有 Web 原型的 lint 错误，使全量 lint 成为可靠的交付信号。治理以不改变会议交互
行为为前提，并为后续功能开发减少噪声。

## 范围

### 包含

- 修复 `web/app/page.tsx` 中现有 React Hooks 规则和显式 `any` 错误。
- 保持现有页面和本地 WebRTC 行为不变。
- 运行 lint、测试、类型检查和生产构建。

### 不包含

- 服务端信令、账号权限、STUN/TURN 或生产录制能力。
- 借机重构整页视觉样式或改变产品交互。

## 必读上下文

- [`docs/development.md`](../../development.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/product/requirements.md`](../../product/requirements.md)
- [`web/eslint.config.mjs`](../../../web/eslint.config.mjs)
- [`web/app/page.tsx`](../../../web/app/page.tsx)
- [`web/app/use-local-webrtc.ts`](../../../web/app/use-local-webrtc.ts)

## 约束与假设

- 约束：不改变用户可观察的会议流程和 WebRTC 状态机。
- 约束：所有 Web 改动交付前运行 `npm run check`。
- 假设：现有 lint 错误主要来自规则升级后的代码规范不兼容；通过逐项 lint 和回归测试验证。

## 计划

- [x] 分类现有 lint 错误，确认哪些属于真实问题、哪些需要安全的规则边界调整。
- [x] 修复页面代码中的类型和 Hooks 规则问题。
- [x] 运行全量验证并更新任务交接记录。

## 验收标准

- [x] `npm run lint` 通过。
- [x] `npm run check` 通过。
- [x] 会议页面和本地 WebRTC 回归测试行为不变。
- [x] 任务记录和开发指南与实际验证方式一致。

## 工作记录

- 2026-08-28：承接 0005 发现的全量 lint 基线问题，当前报告 36 个错误，集中在 `page.tsx`
  的 React Hooks 规则和显式 `any`。
- 2026-08-28：将本地预约读取延迟到挂载后的异步 effect，避免 SSR 首屏不一致；补齐页面
  props 类型，并将含 DOM refs 的 WebRTC hook 返回对象拆为渲染状态与独立 refs，消除
  React lint 误判。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 全量 lint | `npm run lint` | 通过，0 个错误 | 2026-08-28 |
| 页面与 WebRTC 回归 | `npm run test` | 14 个用例全部通过 | 2026-08-28 |
| 类型检查与生产构建 | `npm run check` | 测试、TypeScript、生产构建全部通过 | 2026-08-28 |

## 交接

- 当前状态：lint 基线治理已完成，改动尚未提交；工作区同时保留 0005 的未提交改动。
- 改动范围：`web/app/page.tsx`、`docs/development.md` 及本任务记录。
- 风险与未决问题：生产构建仍会显示 Vinext 对动态 API 的既有分类提示，但构建成功且不影响当前原型。
- 下一步：可继续推进服务端信令与房间鉴权设计，或单独建立技术方案任务。
