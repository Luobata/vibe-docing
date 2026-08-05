## 协作编排

- 当用户明确要求“推进开发、交付、拆解并分工”，或任务确实需要多个项目角色协作时，使用 `local_agent_workbench` MCP。
- 仅讨论需求、方案或设计时，不要自动启动协作编排。
- 默认通过 `run_workflow` 调用 Workflow `xiaomiwang-development-team`。
- `project` 使用当前项目名称。新任务不传 `contextId`；只有继续同一次协作编排时，才复用稳定的 `contextId`。
- 调用完成后汇总运行状态和 `runId`；结果为 `blocked` 或 `failed` 时，明确说明阻塞或故障原因。
- 如果 MCP 或目标入口不可用，应报告配置问题，不要在本地伪造协作结果。
