# 0086：报告导出活动明细

- 状态：已完成
- 负责人：Codex
- 创建日期：2026-08-30
- 更新日期：2026-08-30
- 关联需求：REQ-006
- 关联决策：无

## 目标

让当前本地会话导出的报告摘要包含具体已发布活动名称，避免导出文件只有数量、无法与报告页面的互动明细互相核对。

## 范围

### 包含

- 从经过校验的会话快照生成已发布活动名称明细。
- 无已发布活动时在导出摘要中明确写出“无”。
- 为导出内容补充回归测试并更新项目边界说明。

### 不包含

- 不接入服务端报告、成绩或课堂活动数据。
- 不改变历史演示报告的统计模型。

## 必读上下文

- [`docs/product/overview.md`](../../product/overview.md)
- [`docs/product/requirements.md`](../../product/requirements.md)
- [`docs/architecture/overview.md`](../../architecture/overview.md)
- [`docs/development.md`](../../development.md)
- [`web/app/page.tsx`](../../web/app/page.tsx)
- [`web/app/page.test.tsx`](../../web/app/page.test.tsx)

## 约束与假设

- 约束：报告快照只允许引用 `activityTypes` 中已知的活动 ID。
- 约束：导出结果是本地 Blob 文本，不代表服务端报告。
- 假设：用户需要在本地导出文件中核对页面已显示的活动名称；通过 Blob 内容回归测试验证。

## 计划

- [x] 导出当前会话的活动明细，并补充有活动/无活动测试。
- [x] 更新项目文档，运行完整门禁并记录证据。

## 验收标准

- [x] 当前会话导出摘要包含具体活动名称和数量。
- [x] 当前会话未发布活动时导出摘要明确显示无活动。
- [x] 相关验证通过，任务记录与实际代码一致。

## 工作记录

- 2026-08-30：审计发现报告页面已渲染具体活动名称，但导出摘要仅写入活动数量。

## 验证证据

| 验证内容 | 方式 | 结果 | 日期 |
| --- | --- | --- | --- |
| 页面报告导出 | `npm test -- app/page.test.tsx` | 84 项通过 | 2026-08-30 |
| 全量测试 | `npm run check` | 2 个测试文件、110 项通过 | 2026-08-30 |
| 类型检查与构建 | `npm run check` | typecheck、vinext build 通过；仅有既有代理和动态路由分类提示 | 2026-08-30 |
| 代码规范 | `npm run lint` | 通过 | 2026-08-30 |
| 差异检查 | `git diff --check` | 通过；仅有换行符提示 | 2026-08-30 |

## 交接

- 当前状态：报告导出活动明细已完成，改动尚未提交。
- 改动范围：`web/app/page.tsx`、`web/app/page.test.tsx`、`docs/product/requirements.md`、`docs/architecture/overview.md`。
- 风险与未决问题：导出仍是前端本地摘要，不具备服务端报告的分享或归档能力。
- 下一步：继续审计 WebRTC 设备轨道结束、设备切换与重新加入的组合边界。
