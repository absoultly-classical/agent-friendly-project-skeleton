# 0152：随机标识运行时降级

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 关联需求：REQ-001、REQ-014、REQ-019

## 目标

当运行环境没有 `crypto.randomUUID()` 但仍具备页面运行能力时，会议页和本机房间生成
不应在渲染/创建阶段直接抛异常；优先使用 Web Crypto 随机值，最后才使用低风险的本地
时间/随机组合。该标识只用于本地 peer 路由和房间候选，不承担鉴权。

## 必读上下文

- `docs/architecture/overview.md`
- `docs/product/requirements.md`
- `web/app/page.tsx`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`
- `web/app/page.test.tsx`

## 计划

- [x] 审计页面渲染、房间生成和 WebRTC peer ID 的随机 API 依赖。
- [x] 增加统一的随机标识降级实现并复用。
- [x] 补充缺少 `randomUUID` 时的 hook、页面入口回归测试。
- [x] 运行门禁、更新架构记录并归档。

## 验收标准

- [x] 缺少 `crypto.randomUUID` 时会议页仍可渲染。
- [x] 缺少 `randomUUID` 时本机房间仍能生成合法 9 位数字候选。
- [x] 现有随机 UUID 路径和房间冲突规避行为不回退。
- [x] 测试、类型检查、构建、Lint 和 HTTP 检查通过。

## 工作记录

- 2026-08-30：发现 `makePeerId` 和 `createLocalRoomId` 直接调用 `crypto.randomUUID()`，能力检查无法在调用前拦截缺失 API。
- 2026-08-30：新增统一的随机标识降级实现，优先使用 `randomUUID`，其次使用 `getRandomValues`，最后使用时间戳和随机组合；页面房间生成、资料上传和 WebRTC peer 标识统一复用。
- 2026-08-30：补充页面与 WebRTC hook 的运行时缺少随机 API 回归测试，完成全量门禁。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 随机标识降级回归 | Vitest/jsdom | 页面与 hook 回归通过；全量 2 个测试文件、193/193 通过 | 2026-08-30 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-30 |
| Lint | `npm run lint` | 通过 | 2026-08-30 |
| 构建 | `npm run build` | 通过 | 2026-08-30 |
| HTTP 检查 | `Invoke-WebRequest -UseBasicParsing http://localhost:3000/` | 200，29404 bytes | 2026-08-30 |
| Diff 检查 | `git diff --check` | 通过（仅换行符提示） | 2026-08-30 |
