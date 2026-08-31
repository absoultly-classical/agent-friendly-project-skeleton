# 0135：WebRTC 信令载荷边界

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 完成日期：2026-08-30
- 关联需求：REQ-014、REQ-018

## 目标

在本地 WebRTC 实验接收信令前限制 peer 标识、SDP 和 ICE candidate 的载荷规模，避免异常同源窗口把无界数据交给 WebRTC 实现或推高页面资源消耗。

## 完成内容

- 限制信令来源/目标标识、SDP、candidate、SDP mid 和 username fragment 的长度。
- 要求 ICE 的 `sdpMLineIndex` 为非负整数或标准允许的空值。
- 超出边界或类型异常的消息在交给 WebRTC 前丢弃。
- 增加超大 offer、candidate 和 peer 标识的 fake WebRTC 回归测试。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| WebRTC 信令边界 | Vitest/fake WebRTC | 41/41 定向测试通过 | 2026-08-30 |
| 全量测试 | `npm test` | 2 个测试文件、171/171 通过 | 2026-08-30 |
| 类型检查 | `npm run typecheck` | 通过 | 2026-08-30 |
| Lint | `npm run lint` | 通过 | 2026-08-30 |
| 构建 | `npm run build` | 通过 | 2026-08-30 |
| HTTP 检查 | `Invoke-WebRequest http://localhost:3000/` | 200 | 2026-08-30 |
| Diff 检查 | `git diff --check` | 通过 | 2026-08-30 |

## 影响与边界

本地 WebRTC 仍仅支持同源窗口，不提供服务端信令、身份认证、访问控制或跨设备连接。载荷限制用于保护本地实验状态和 WebRTC 调用边界，不等价于生产级协议安全校验。
