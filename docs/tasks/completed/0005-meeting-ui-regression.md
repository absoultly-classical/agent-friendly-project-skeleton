# 0005：会议页面回归与交互稳固

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-28
- 更新日期：2026-08-28
- 关联需求：REQ-003、REQ-007、REQ-013 至 REQ-019
- 关联决策：ADR-0001

## 目标

为会中页面的本地会议入口补充页面级回归覆盖，确保加入、权限失败、离会和主要控制反馈
在后续迭代中保持可用。页面测试将复用已有的无硬件 WebRTC 模拟边界，不引入真实设备或
跨网络依赖。

## 范围

### 包含

- 为会中页面建立可重复的测试入口和测试夹具。
- 覆盖进入本地会议、媒体权限失败、静音/摄像头控制和离会反馈。
- 修复测试暴露的页面交互或资源清理问题。
- 在任务记录中沉淀验证证据和后续风险。

### 不包含

- 服务端房间、信令、账号权限、STUN/TURN 或生产录制能力。
- 真实浏览器设备兼容性和跨网络质量测试。

## 必读上下文

- [`docs/product/requirements.md`](../../product/requirements.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/development.md`](../../development.md)
- [`web/app/page.tsx`](../../../web/app/page.tsx)
- [`web/app/use-local-webrtc.ts`](../../../web/app/use-local-webrtc.ts)
- [`web/app/use-local-webrtc.test.tsx`](../../../web/app/use-local-webrtc.test.tsx)
- [`web/test/setup.ts`](../../../web/test/setup.ts)

## 约束与假设

- 约束：页面测试不得访问真实摄像头、麦克风或屏幕权限。
- 约束：所有 Web 改动交付前运行 `npm run check`。
- 假设：现有页面状态通过 React 本地状态驱动，测试可在 jsdom 中直接进入会中视图；通过
  页面测试验证。

## 计划

- [x] 阅读会中页面入口和现有模拟环境，确定最小测试夹具。
- [x] 增加页面级回归用例，并修复暴露的问题。
- [x] 运行测试、类型检查和生产构建，更新需求/开发与任务记录。

## 验收标准

- [x] 页面测试覆盖加入本地会议、权限失败、关键控制和离会反馈。
- [x] 现有 WebRTC 内核测试与完整检查通过。
- [x] 任务记录、受影响的长期文档与实际行为一致。

## 工作记录

- 2026-08-28：发现“我的会议”搜索输入未驱动列表筛选，补充主题、课程和类型筛选及空
  结果反馈。
- 2026-08-28：复用现有媒体、信令和 WebRTC 模拟环境，增加会议页面级回归测试，不引入
  真实设备依赖。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 页面与 WebRTC 回归 | `npm run test` | 14 个用例全部通过（页面 5 个、内核 9 个） | 2026-08-28 |
| 类型检查与生产构建 | `npm run check` | 测试、TypeScript、生产构建全部通过 | 2026-08-28 |
| 新增测试文件规范 | `npx eslint app/page.test.tsx` | 通过 | 2026-08-28 |
| 改动格式 | `git diff --check` | 通过 | 2026-08-28 |
| 全量 lint | `npm run lint` | 未通过；既有 `page.tsx` 有 36 个 Hooks/`any` 问题，本任务未扩大范围 | 2026-08-28 |

## 交接

- 当前状态：会议页面关键流程已有自动化回归，“我的会议”搜索已可按主题、课程和类型
  筛选；任务已完成，改动尚未提交。
- 改动范围：`web/app/page.tsx`、`web/app/page.test.tsx`、`web/app/globals.css`、
  `docs/product/requirements.md`、`docs/development.md`。
- 风险与未决问题：全量 lint 的既有问题仍待单独治理；Node 22.20.0 低于 jsdom 声明的
  22.22.2 最低版本，但本次 14 个测试已通过。
- 下一步：如要继续，可单独建立 lint 治理任务，或推进服务端信令与房间鉴权设计。


