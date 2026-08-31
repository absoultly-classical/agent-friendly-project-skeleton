# 0129：建立连接前的屏幕共享

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-003、REQ-014、REQ-016
- 关联决策：无

## 目标

用户在等待对方加入时先开启屏幕共享，待对端建立连接后，远端应直接收到当前屏幕轨道，而不是错误地收到摄像头轨道。

## 范围

### 包含

- 创建 peer 时根据当前共享状态选择屏幕视频轨道。
- 保留共享停止后恢复摄像头的既有行为。
- 补充“先共享、后入会”的 WebRTC 回归测试。

### 不包含

- 不改变屏幕共享权限、轨道替换和共享结束处理。
- 不实现服务端会议或跨设备媒体传输。

## 必读上下文

- `docs/product/requirements.md`
- `docs/architecture/overview.md`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`

## 计划

- [x] 定位 peer 创建时对共享轨道的选择逻辑。
- [x] 修正先共享后连接的轨道选择并补充测试。
- [x] 运行门禁、更新架构记录并归档。

## 验收标准

- [x] 建立连接前开启共享，peer 创建后发送屏幕轨道。
- [x] 摄像头轨道不会与屏幕轨道重复发送。
- [x] 页面测试、类型检查、构建、Lint 和 HTTP 检查通过。

## 验证证据

- `npm test -- app/use-local-webrtc.test.tsx`：37/37 通过。
- `npm run check`：161/161 测试通过，TypeScript 检查和生产构建通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `Invoke-WebRequest -UseBasicParsing http://localhost:3000/`：HTTP 200。

## 风险与边界

屏幕共享仍是当前页面的本地浏览器能力；用户取消授权或结束共享时按现有错误恢复路径处理。
