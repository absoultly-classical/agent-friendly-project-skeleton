# 0016：防止 WebRTC 异步操作过期回写

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-28
- 更新日期：2026-08-28
- 关联需求：REQ-013 至 REQ-019
- 关联决策：ADR-0001

## 目标

防止设备权限请求或设备切换在用户离会、重新加入后才返回时，旧操作重新写入页面状态或
泄漏媒体资源，提升本地会议实验的资源清理和状态一致性。

## 范围

### 包含

- 为异步入会、设备切换和屏幕共享增加操作代次保护。
- 过期媒体流和轨道及时停止，不回写当前会话。
- 增加模拟延迟和离会竞态回归测试。

### 不包含

- 浏览器权限弹窗、真实设备驱动和跨网络 WebRTC 互操作测试。
- 服务端重连协议或生产级会话管理。

## 必读上下文

- [`docs/product/requirements.md`](../../product/requirements.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/development.md`](../../development.md)
- [`web/app/use-local-webrtc.ts`](../../../web/app/use-local-webrtc.ts)
- [`web/app/use-local-webrtc.test.tsx`](../../../web/app/use-local-webrtc.test.tsx)
- [`web/test/setup.ts`](../../../web/test/setup.ts)
- [`docs/tasks/completed/0015-material-search-details.md`](../completed/0015-material-search-details.md)

## 约束与假设

- 约束：测试使用可控的媒体、信令和连接模拟，不使用浏览器测试。
- 约束：过期操作不能影响当前有效会话的状态和资源。
- 假设：未来接入真实设备时，标准媒体 API 的 Promise 生命周期仍需经过同样的过期检查。

## 计划

- [x] 增加会话操作代次并保护异步入会回写。
- [x] 保护设备切换和屏幕共享的过期轨道。
- [x] 补充竞态测试、运行完整检查并更新文档。

## 验收标准

- [x] 离会后才返回的媒体流会被停止且不会出现在当前状态。
- [x] 重新加入后，旧入会请求不能覆盖新会话。
- [x] 过期设备切换或共享轨道会被停止且不替换当前轨道。
- [x] 测试、lint、类型检查和生产构建通过。

## 工作记录

- 2026-08-28：确认权限请求、设备切换和屏幕共享在离会后返回时可能继续写入旧会话。
- 2026-08-28：为 cleanup 引入操作代次，在异步返回和信令回调中阻止过期操作回写，并停止过期轨道。
- 2026-08-28：增加媒体请求、设备切换和共享竞态测试；内核 11 项、全量 26 项 jsdom 测试通过。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| WebRTC 竞态路径 | `npx vitest run app/use-local-webrtc.test.tsx` | 通过：11 项测试 | 2026-08-28 |
| 全量回归 | `npm run test`（jsdom/Vitest） | 通过：2 个测试文件、26 项测试 | 2026-08-28 |
| 代码规范 | `npm run lint` | 通过 | 2026-08-28 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-28 |
| 生产构建 | `npm run build`（由 `npm run check` 执行） | 通过；Vinext 完成构建，仅保留既有静态分析提示 | 2026-08-28 |
| 差异格式 | `git diff --check` | 通过 | 2026-08-28 |

## 交接

- 当前状态：已完成，过期 WebRTC 操作不会重新写入当前会话或泄漏轨道；改动尚未提交。
- 改动范围：`web/app/use-local-webrtc.ts`、`web/app/use-local-webrtc.test.tsx`、本任务记录和任务索引。
- 风险与未决问题：该保护解决前端异步竞态，不替代服务端会话、权限和重连协议。
- 下一步：继续检查移动端布局与会议入口在不同状态下的可达性。
