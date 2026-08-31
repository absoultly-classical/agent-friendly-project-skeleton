# 0020：接入加入会议媒体偏好

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-28
- 更新日期：2026-08-28
- 关联需求：REQ-001、REQ-003、REQ-013、REQ-015
- 关联决策：ADR-0001

## 目标

让加入会议弹窗中的麦克风和摄像头开关真正影响本地入会采集，确保用户选择关闭设备时
不会仍然请求对应媒体权限。

## 范围

### 包含

- 将加入会议的媒体开关改为受控状态。
- 将媒体偏好传入本地 WebRTC 入会流程。
- 让无音频或无视频入会时页面状态与轨道实际情况一致。
- 增加无浏览器媒体约束回归测试。

### 不包含

- 服务端入会权限、远端成员偏好同步和设备权限弹窗控制。
- 浏览器或真实设备测试。

## 必读上下文

- [`docs/product/requirements.md`](../../product/requirements.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/development.md`](../../development.md)
- [`web/app/page.tsx`](../../../web/app/page.tsx)
- [`web/app/use-local-webrtc.ts`](../../../web/app/use-local-webrtc.ts)
- [`web/app/page.test.tsx`](../../../web/app/page.test.tsx)
- [`web/test/setup.ts`](../../../web/test/setup.ts)
- [`docs/tasks/completed/0019-safe-scheduled-storage.md`](../completed/0019-safe-scheduled-storage.md)

## 约束与假设

- 约束：媒体开关只控制当前本地实验的采集约束，不代表服务端设备策略。
- 约束：不使用浏览器测试，使用可控媒体模拟检查请求约束和页面状态。
- 假设：后续接入真实设备时，`audio`/`video` 布尔选项仍可作为入会配置的一部分。

## 计划

- [x] 定义入会媒体偏好并让弹窗受控。
- [x] 将偏好接入 WebRTC 采集约束和会中展示。
- [x] 补充测试、运行完整检查并更新文档。

## 验收标准

- [x] 取消麦克风后入会请求使用 `audio: false`。
- [x] 取消摄像头后入会请求使用 `video: false`。
- [x] 仅关闭某一设备时，另一设备仍可正常采集。
- [x] 测试、lint、类型检查和生产构建通过。

## 工作记录

- 2026-08-28：确认加入会议弹窗的设备复选框没有进入实际 `getUserMedia` 约束。
- 2026-08-28：增加受控媒体偏好，将 `audio`/`video` 选项传入 WebRTC 入会并同步会中按钮状态。
- 2026-08-28：补充关闭两类设备的媒体约束页面测试；全量 32 项 jsdom 测试通过。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 入会媒体偏好 | `npm run test`（jsdom/Vitest） | 通过：2 个测试文件、32 项测试 | 2026-08-28 |
| 代码规范 | `npm run lint` | 通过 | 2026-08-28 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-28 |
| 生产构建 | `npm run build`（由 `npm run check` 执行） | 通过；Vinext 完成构建，仅保留既有静态分析提示 | 2026-08-28 |
| 差异格式 | `git diff --check` | 通过 | 2026-08-28 |

## 交接

- 当前状态：已完成，加入会议的媒体开关会驱动本地采集约束；改动尚未提交。
- 改动范围：`web/app/page.tsx`、`web/app/use-local-webrtc.ts`、`web/app/page.test.tsx`、任务记录和任务索引。
- 风险与未决问题：当前媒体约束仍只作用于本机实验，不包含服务端成员策略。
- 下一步：继续审计主导航的状态语义、移动端入口和会议控制的异常提示。
