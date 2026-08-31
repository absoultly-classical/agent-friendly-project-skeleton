# 0128：无媒体入会能力检查

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-001、REQ-013、REQ-014
- 关联决策：无

## 目标

当用户明确关闭音频和视频时，不因当前环境缺少媒体采集 API 而阻止纯聊天或旁听入会。

## 范围

### 包含

- 仅在需要采集音频或视频时检查 `getUserMedia`。
- 无媒体入会仍检查 `RTCPeerConnection` 和 `BroadcastChannel`。
- 补充媒体 API 不可用时的无媒体入会测试。

### 不包含

- 不绕过用户主动开启音视频时的媒体能力检查。
- 不改变 WebRTC 信令、权限申请或媒体轨道行为。

## 必读上下文

- `docs/product/requirements.md`
- `docs/architecture/overview.md`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`

## 计划

- [x] 定位无媒体分支与能力检查的矛盾。
- [x] 修正能力判断并补充回归测试。
- [x] 运行门禁、更新架构记录并归档。

## 验收标准

- [x] 无媒体入会不要求 `getUserMedia` 存在。
- [x] 开启任一媒体时仍能正确提示媒体 API 不可用。
- [x] 页面测试、类型检查、构建、Lint 和 HTTP 检查通过。

## 验证证据

- `npm test -- app/use-local-webrtc.test.tsx`：36/36 通过。
- `npm run check`：160/160 测试通过，TypeScript 检查和生产构建通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `Invoke-WebRequest -UseBasicParsing http://localhost:3000/`：HTTP 200。

## 风险与边界

无媒体入会仍依赖本地点对点信令能力，不能在 WebRTC 或同源频道不可用时继续。
