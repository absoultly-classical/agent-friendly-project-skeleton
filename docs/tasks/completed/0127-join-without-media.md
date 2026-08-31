# 0127：无媒体入会

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-001、REQ-013、REQ-014、REQ-015
- 关联决策：无

## 目标

允许用户在入会前同时关闭麦克风和摄像头，以纯聊天或旁听方式进入本地会议，不因空媒体约束被浏览器拒绝。

## 范围

### 包含

- 音频和视频均关闭时不调用 `getUserMedia`，创建空本地媒体流并进入等待状态。
- 保留现有无视频入会、聊天和离会行为。
- 补充无媒体入会回归测试和边界说明。

### 不包含

- 不伪造音视频轨道或远端媒体。
- 不改变浏览器权限申请和真实媒体采集路径。

## 必读上下文

- `docs/product/requirements.md`
- `docs/architecture/overview.md`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`

## 计划

- [x] 定位入会偏好与 `getUserMedia` 调用的约束冲突。
- [x] 支持空媒体流入会并补充回归测试。
- [x] 运行门禁、更新架构记录并归档。

## 验收标准

- [x] 音频、视频均关闭时可以进入等待状态。
- [x] 音频、视频均关闭时不请求设备权限。
- [x] 页面测试、类型检查、构建、Lint 和 HTTP 检查通过。

## 验证证据

- `npm test -- app/use-local-webrtc.test.tsx`：34/34 通过。
- `npm test -- app/page.test.tsx`：124/124 通过。
- `npm run check`：158/158 测试通过，TypeScript 检查和生产构建通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `Invoke-WebRequest -UseBasicParsing http://localhost:3000/`：HTTP 200。

## 风险与边界

无媒体入会仍依赖同源本地信令；没有媒体轨道时不能进行音视频发送或屏幕共享。
