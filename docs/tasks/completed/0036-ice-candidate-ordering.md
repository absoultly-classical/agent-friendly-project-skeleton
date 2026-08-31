# TASK-ID：ICE 候选时序容错

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-29
- 更新日期：2026-08-29
- 关联需求：REQ-014、REQ-019
- 关联决策：ADR-0001

## 目标

让本地 WebRTC 信令能够容忍 ICE 候选早于远端会话描述到达的正常时序，避免两个同源窗口在真实浏览器中因消息先后顺序导致协商失败。

## 范围

### 包含

- 暂存远端描述尚未建立时收到的 ICE 候选。
- 设置远端描述后按顺序刷新候选队列。
- 离会、重连和新会话开始时清空旧候选。
- 用 fake peer 强制要求先设置远端描述，并补充乱序信令测试。

### 不包含

- 不改变 BroadcastChannel 信令格式或引入服务端信令。
- 不实现多方会议的候选路由和网络质量优化。

## 必读上下文

- `docs/product/overview.md`
- `docs/architecture/overview.md`
- `docs/development.md`
- `web/app/use-local-webrtc.ts`
- `web/app/use-local-webrtc.test.tsx`
- `web/test/setup.ts`

## 约束与假设

- 约束：候选只能应用到当前会话对应的 RTCPeerConnection。
- 约束：候选刷新失败仍需进入现有协商错误提示，不吞掉异常。
- 假设：fake peer 在未设置远端描述时拒绝候选，可以稳定复现真实 API 的时序要求。

## 计划

- [x] 实现候选暂存和远端描述后的刷新。
- [x] 增强 fake peer 并补充乱序信令回归测试。
- [x] 运行完整检查并归档任务。

## 验收标准

- [x] ICE 先到时不会立即把当前会话置为协商失败。
- [x] 远端描述建立后暂存候选会被全部应用。
- [x] 离会后旧候选不会污染下一次加入。
- [x] 测试、lint、类型检查、生产构建和 diff 检查通过。

## 工作记录

- 2026-08-29：审计发现 `ice` 消息处理没有判断 `remoteDescription`，直接调用 `addIceCandidate`，存在真实浏览器时序竞态。
- 2026-08-29：在 hook 中增加按会话隔离的候选队列；收到 ICE 时若远端描述未就绪则暂存，offer/answer 设置成功后按顺序刷新。
- 2026-08-29：fake peer 在缺少远端描述时拒绝 ICE，并通过乱序消息回归测试验证候选最终成功应用。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 乱序 ICE 回归 | `npm test -- --run` | 2 个测试文件、56 项通过 | 2026-08-29 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-29 |
| lint | `npm run lint` | 通过 | 2026-08-29 |
| 生产构建 | `npm run build` | 通过；vinext 仅提示动态路由分类 warning | 2026-08-29 |
| diff 检查 | `git diff --check` | 通过；仅有换行符提示 | 2026-08-29 |

## 交接

- 当前状态：已完成并已归档。
- 改动范围：`web/app/use-local-webrtc.ts`、`web/test/setup.ts`、`web/app/use-local-webrtc.test.tsx` 及本任务文档。
- 风险与未决问题：候选时序修复不保证 NAT、TURN 或跨网络连通性。
- 下一步：继续审计本地会议实验的会话边界和错误恢复路径。
