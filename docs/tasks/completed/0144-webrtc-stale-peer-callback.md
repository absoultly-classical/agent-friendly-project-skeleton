# 0144：忽略旧 WebRTC 对等连接回调

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-014、REQ-015、REQ-016、REQ-017

## 目标

离会并重新加入后，旧 `RTCPeerConnection` 的异步连接状态和 ICE 回调不得影响
当前会话，也不得向已经关闭的旧信令频道发送候选。

## 必读上下文

- `docs/architecture/overview.md`
- `docs/product/requirements.md`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`

## 计划

- [x] 审计旧 peer 的事件回调与会话代次校验。
- [x] 为连接状态和 ICE 回调增加当前操作、当前 peer 双重校验。
- [x] 补充离会重入后的旧回调回归测试。
- [x] 运行门禁、更新架构记录并归档。

## 验收标准

- [x] 旧 peer 的 `connected`/`connecting` 状态不能覆盖当前会话状态。
- [x] 旧 peer 的 ICE 候选不会发送到已关闭的旧频道或当前新会话。
- [x] 正常同源协商、失败清理、设备切换和屏幕共享行为不回退。
- [x] 测试、类型检查、构建、Lint 和 HTTP 检查通过。

## 工作记录

- 2026-08-30：发现连接状态回调只在失败恢复路径检查会话代次；连接成功/连接中分支可被旧 peer 异步事件触发。ICE 回调同样缺少旧 peer 校验。
- 2026-08-30：连接状态与 ICE 回调增加会话代次和当前 peer 双重校验，并补充离会重入回归测试。
- 2026-08-30：完成全量门禁，0144 验收通过。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 旧 peer 回调回归 | Vitest/jsdom | 43/43 通过（定向） | 2026-08-30 |
| 全量测试 | `npm test -- --runInBand` | 2 个测试文件、183/183 通过 | 2026-08-30 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-30 |
| Lint | `npm run lint` | 通过 | 2026-08-30 |
| 构建 | `npm run build` | 通过 | 2026-08-30 |
| HTTP 检查 | `Invoke-WebRequest http://localhost:3000/` | 200 | 2026-08-30 |
| Diff 检查 | `git diff --check` | 通过 | 2026-08-30 |
