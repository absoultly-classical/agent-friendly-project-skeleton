# 项目知识地图

本页是项目长期知识的统一入口。它应保持简短，以链接为主，帮助 Agent 判断下一步
该读什么，而不是把所有背景堆在一个文件里。

## 权威文档

| 要回答的问题 | 事实来源 | 什么时候更新 |
| --- | --- | --- |
| 项目为什么存在？ | [`product/overview.md`](product/overview.md) | 目标、用户或范围变化时 |
| 系统必须表现出什么行为？ | [`product/requirements.md`](product/requirements.md) | 新增或修改需求时 |
| 领域术语是什么意思？ | [`product/glossary.md`](product/glossary.md) | 引入新术语或出现歧义时 |
| 系统由什么组成？ | [`architecture/overview.md`](architecture/overview.md) | 组件、边界或关键流程变化时 |
| 为什么做出某项长期选择？ | [`decisions/README.md`](decisions/README.md) | 采纳或替代重要决策时 |
| 如何开发和验证？ | [`development.md`](development.md) | 工具、流程或验证方式变化时 |
| 如何运行和恢复系统？ | [`operations/runbook.md`](operations/runbook.md) | 运行或故障处理方式变化时 |
| 现在正在做什么？ | [`tasks/ACTIVE.md`](tasks/ACTIVE.md) | 任务开始、暂停、交接或完成时 |

## 上下文边界

版本库中的代码和文档属于长期上下文。聊天、终端输出、个人笔记、外部工单描述和
Agent 记忆属于临时上下文。临时信息一旦会影响后续工作，就应提炼出必要事实，写入
对应的权威文档或当前任务；不要整段复制聊天内容。

同一事实尽量只维护一份，其他地方通过链接引用。确需重复说明时，应明确标注哪一份
是权威来源。

## 文档维护规则

- 对外行为发生变化时，更新需求文档。
- 组件、数据归属或依赖方向发生变化时，更新架构文档；重要选择同时建立决策记录。
- 新发现且不直观的约束，写入权威文档或决策记录。
- 开发和验证方式变化时，在同一次工作中更新开发指南。
- 完成的任务从 `tasks/active/` 移到 `tasks/completed/`。任务记录用于追溯过程，长期
  有效的结论必须提升到相应权威文档。

