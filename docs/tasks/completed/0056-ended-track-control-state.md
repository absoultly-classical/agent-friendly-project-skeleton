# TASK-ID：结束媒体轨道控制状态

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-29
- 更新日期：2026-08-29
- 关联需求：REQ-003、REQ-013、REQ-015、REQ-019

## 目标

当摄像头或麦克风轨道进入 `ended` 状态时，及时禁用对应控制，避免界面显示可操作但实际无效。

## 范围

### 包含

- hook 的静音和摄像头切换只操作仍处于 live 状态的轨道。
- 会中按钮按轨道 `readyState` 判断是否可用。
- fake MediaStreamTrack 模拟 `readyState` 生命周期并补回归测试。

### 不包含

- 不改变设备断开后的重新加入流程。
- 不实现设备热插拔自动恢复。

## 计划

- [x] 审计轨道结束后的状态和控制按钮条件。
- [x] 按 `readyState` 过滤 ended 轨道。
- [x] 增加设备轨道结束后的页面回归测试。
- [x] 执行完整检查并归档任务。

## 验收标准

- [x] 麦克风 ended 后静音控制禁用。
- [x] 摄像头 ended 后视频控制禁用。
- [x] 仍处于 live 的另一类轨道不受影响。
- [x] 测试、lint、类型检查、生产构建和 diff 检查通过。

## 工作记录

- 2026-08-29：审计发现控制按钮仅判断媒体轨道数量，未判断 `MediaStreamTrack.readyState`，设备断开后仍可点击。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 轨道结束回归 | `npm test -- app/page.test.tsx app/use-local-webrtc.test.tsx` | 通过：78 tests | 2026-08-29 |
| 完整自动化检查 | `npm run check` | 通过：78 tests、typecheck、build | 2026-08-29 |
| lint | `npm run lint` | 通过 | 2026-08-29 |
| diff 格式检查 | `git diff --check` | 通过（仅有换行符提示） | 2026-08-29 |

## 交接

- 当前状态：已完成并可交接。
- 改动范围：`web/app/use-local-webrtc.ts`、`web/app/page.tsx`、`web/test/setup.ts` 及测试。
- 风险与未决问题：真实设备驱动的 ended 事件仍需用户授权环境观察，本地 fake 仅验证应用状态处理。
- 下一步：继续审计会中状态提示、重连与退出后的资源回收。
