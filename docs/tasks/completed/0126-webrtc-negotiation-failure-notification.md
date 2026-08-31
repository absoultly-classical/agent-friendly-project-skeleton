# 0126：协商失败通知对端

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-014、REQ-018
- 关联决策：无

## 目标

当一端的 WebRTC 信令协商失败时，通知同房间的另一端清理旧连接，避免对端停留在不可恢复的连接状态。

## 范围

### 包含

- 信令处理异常时向当前对端发送 `leave` 消息。
- 保留失败端的统一资源清理和错误提示。
- 补充双窗口协商失败后的双方状态回归测试。

### 不包含

- 不实现自动重连或重试策略。
- 不改变普通主动离会和 peer 状态失败的既有处理。

## 必读上下文

- `docs/architecture/overview.md`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`

## 计划

- [x] 定位协商异常与对端状态不同步的路径。
- [x] 通知对端并补充回归测试。
- [x] 运行门禁、更新架构记录并归档。

## 验收标准

- [x] 协商失败端进入错误状态并释放资源。
- [x] 对端收到失败通知后回到等待状态。
- [x] 页面测试、类型检查、构建、Lint 和 HTTP 检查通过。

## 验证证据

- `npm test -- app/use-local-webrtc.test.tsx`：33/33 通过。
- `npm run check`：157/157 测试通过，TypeScript 检查和生产构建通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `Invoke-WebRequest -UseBasicParsing http://localhost:3000/`：HTTP 200。

## 风险与边界

失败后仍需用户主动重新加入；离会消息只在同源本地实验频道内有效。
