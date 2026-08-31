# 0017：统一会中退出资源清理

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-28
- 更新日期：2026-08-28
- 关联需求：REQ-003、REQ-013 至 REQ-019
- 关联决策：ADR-0001

## 目标

确保会中所有离开路径都释放本地媒体和点对点连接，避免用户通过返回首页离开时仍然
占用摄像头、麦克风或信令频道。

## 范围

### 包含

- 将会中返回首页操作接入 WebRTC `leave` 清理。
- 保持结束课堂进入报告的既有行为。
- 增加已入会后返回首页的页面回归测试。

### 不包含

- 浏览器设备权限、操作系统级资源监控和服务端会话回收。
- 浏览器或真实设备测试。

## 必读上下文

- [`docs/product/requirements.md`](../../product/requirements.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/development.md`](../../development.md)
- [`web/app/page.tsx`](../../../web/app/page.tsx)
- [`web/app/use-local-webrtc.ts`](../../../web/app/use-local-webrtc.ts)
- [`web/app/page.test.tsx`](../../../web/app/page.test.tsx)
- [`docs/tasks/completed/0016-webrtc-stale-operation-guard.md`](../completed/0016-webrtc-stale-operation-guard.md)

## 约束与假设

- 约束：所有退出路径必须通过同一个本地 `leave` 清理边界。
- 约束：不使用浏览器测试，使用现有媒体模拟和页面测试验证资源状态。
- 假设：后续接入服务端时，页面退出仍应保留前端资源清理，再补充服务端离会通知。

## 计划

- [x] 修复返回首页按钮的清理路径。
- [x] 补充页面资源清理测试并运行完整检查。
- [x] 更新文档并归档任务。

## 验收标准

- [x] 已入会后点击返回首页，页面回到首页且本地媒体流被清理。
- [x] 返回首页不会进入报告页，结束课堂行为不受影响。
- [x] 测试、lint、类型检查和生产构建通过。

## 工作记录

- 2026-08-28：确认会中左上角返回首页只切换视图，没有调用本地 WebRTC `leave`。
- 2026-08-28：返回首页前统一调用 `call.leave()`，确保媒体轨道、连接和信令频道释放。
- 2026-08-28：补充已入会后返回首页的页面测试；全量 27 项 jsdom 测试通过。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 返回首页资源清理 | `npx vitest run app/page.test.tsx` | 通过：16 项测试 | 2026-08-28 |
| 全量回归 | `npm run test`（jsdom/Vitest） | 通过：2 个测试文件、27 项测试 | 2026-08-28 |
| 代码规范 | `npm run lint` | 通过 | 2026-08-28 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-28 |
| 生产构建 | `npm run build`（由 `npm run check` 执行） | 通过；Vinext 完成构建，仅保留既有静态分析提示 | 2026-08-28 |
| 差异格式 | `git diff --check` | 通过 | 2026-08-28 |

## 交接

- 当前状态：已完成，返回首页会先释放本地会议资源；改动尚未提交。
- 改动范围：`web/app/page.tsx`、`web/app/page.test.tsx`、本任务记录和任务索引。
- 风险与未决问题：当前只覆盖前端本地资源，不代表服务端会话回收。
- 下一步：继续检查会议入口、移动端布局和弹窗键盘可达性。
