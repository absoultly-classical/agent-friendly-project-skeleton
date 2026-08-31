# 0087：屏幕共享中的设备切换一致性

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 更新日期：2026-08-30
- 关联需求：REQ-016、REQ-017、REQ-019
- 关联决策：ADR-0001

## 目标

修正屏幕共享期间切换摄像头会误替换远端正在接收的屏幕轨道，以及摄像头轨道已经结束时停止共享仍可能错误宣称恢复摄像头的问题。

## 范围

### 包含

- 屏幕共享期间切换摄像头只更新待恢复的本地摄像头轨道，不打断当前屏幕发送轨道。
- 停止屏幕共享前确认摄像头轨道仍可恢复；不可恢复时保留共享并给出明确提示。
- 使用 fake WebRTC 覆盖这两个组合边界。

### 不包含

- 不实现摄像头断开后的自动重新申请权限。
- 不改变屏幕共享的系统选择器、信令协议或生产媒体服务。

## 必读上下文

- [`docs/product/overview.md`](../../product/overview.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/development.md`](../../development.md)
- [`web/app/use-local-webrtc.ts`](../../web/app/use-local-webrtc.ts)
- [`web/app/use-local-webrtc.test.tsx`](../../web/app/use-local-webrtc.test.tsx)
- [`web/test/setup.ts`](../../web/test/setup.ts)

## 约束与假设

- 约束：同一发送器在屏幕共享期间必须继续发送屏幕轨道。
- 约束：主动停止屏幕共享不能把已结束的摄像头轨道重新挂回发送器。
- 假设：fake sender 的当前轨道和 fake track 的 `readyState` 足以验证状态机；已通过自动化测试确认。

## 计划

- [x] 审计并修正屏幕共享与摄像头切换/轨道结束组合。
- [x] 补充回归测试，更新边界文档并运行完整门禁。

## 验收标准

- [x] 屏幕共享时切换摄像头不会改变远端发送器的屏幕轨道，停止共享后恢复新摄像头。
- [x] 摄像头轨道结束时停止共享不会停止屏幕流或伪造恢复成功。
- [x] 相关验证通过，任务记录与实际代码一致。

## 工作记录

- 2026-08-30：审计发现 `switchCamera` 无条件替换视频 sender；屏幕共享期间会让 `sharing` 状态与远端实际轨道不一致。`stopSharing` 也未过滤已结束摄像头轨道。
- 2026-08-30：设备切换期间保留屏幕 sender；停止共享时只接受仍为 `live` 的摄像头轨道进行恢复。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| WebRTC 组合边界 | `npm test -- app/use-local-webrtc.test.tsx` | 28 项通过 | 2026-08-30 |
| 全量测试 | `npm run check` | 2 个测试文件、112 项通过 | 2026-08-30 |
| 类型检查与构建 | `npm run check` | typecheck、vinext build 通过；仅有既有代理和动态路由分类提示 | 2026-08-30 |
| 代码规范 | `npm run lint` | 通过 | 2026-08-30 |
| 差异检查 | `git diff --check` | 通过；仅有换行符提示 | 2026-08-30 |

## 交接

- 当前状态：屏幕共享与设备切换状态一致性已完成，改动尚未提交。
- 改动范围：`web/app/use-local-webrtc.ts`、`web/app/use-local-webrtc.test.tsx`、`docs/architecture/overview.md`。
- 风险与未决问题：真实系统共享和设备驱动行为仍需在授权环境观察；本任务只保证本地状态机不误报。
- 下一步：继续审计本地资料上传/预览和回放发布状态的页面返回与状态持久化边界。
