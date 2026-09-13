# Round 27 · create_visual schema 修复
日期：2026-09-13。状态：实现与本轮验证完成，待 Hub 活体验收。生产改动仅 `packages/server/src/tools/create-visual.ts`，测试仅同目录 `create-visual.test.ts`。

## 问题与结果

工具原声明把 nodes、edges、groups 的数组元素都写成无属性的 object，模型拿不到边的 source/target 或分组的 nodeIds 等字段说明。Hub 合同记录的真实失败为 edges invalid → edges/groups invalid → 两次限额耗尽；本轮未读取真实数据库、未重新调用真实 provider，不能把该现场记录冒充本人的运行结果。

本次补齐工具可见的字段结构、必填项和可选项，并保留原始校验错误前缀，追加模型能据此修正的期望形状。注入 provider 的真实 answer-service 工具循环已验证：第一次错误消息回传后，第二次合法调用产生 visual_ready 并持久化；未修改 answer-service、shared 校验器或 provider。

## 字段核对与实现

实现前实读 `shared/src/visual-artifact.ts:9–33` 三个接口、:95–115 的 isNode/isEdge/isGroup 和 :129–160 场景校验。未发现字段名、必选/可选、基础值类型之间的结构冲突；非空、引用一致性、数量和内容安全是既有运行约束。

| 数组元素 | 必填 | 可选 |
| --- | --- | --- |
| nodes | id、label（非空字符串） | description（字符串，可空）、kind、groupId（非空字符串）、data（对象值限 string/number/boolean/null） |
| edges | id、source、target（非空字符串） | label（字符串，可空）、kind（非空字符串）、directed（布尔） |
| groups | id、label（非空字符串）、nodeIds（非空字符串数组，数组可空） | parentGroupId（非空字符串） |

- `create-visual.ts:6–54`：完整 items.properties/required；对象仅声明接口字段；用非空白 pattern 对齐 nonEmpty。title/altText 同样对齐。nodes/edges 最大数量直接引用 VISUAL_SCENE_LIMITS（60/120），未加 minItems 或 groups 新上限。
- :12：description 说明各集合 id 唯一，以及 source/target/nodeIds 指向节点 id、groupId/parentGroupId 指向分组 id。
- :59–64,78–80：nodes/edges/groups 结构错误附完整字段形状；端点和分组引用错误补充精确引用字段。其余错误原样保留，持久化仍只发生在 validateVisualScene 成功后。

例如错误现在包含：
```text
edges are invalid: edges must be an array of { id: non-empty string, source: node id, target: node id, label?: string, kind?: non-empty string, directed?: boolean }; source and target must reference nodes[].id
```

没有增加运行时校验器、依赖、重试计数或新的工具调用入口。跨对象引用、id 唯一、危险内容仍由原 shared 校验器判断。

## 当前运行证据

使用 Node 22.21.1（与现有 better-sqlite3 ABI 匹配）：

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r build
git diff --check
```

- 全量测试 exit 0：shared **43** + server **324** + web **364** = **731/731**，基线 **724 → 731（+7）**。
- 三个包 typecheck 均 exit 0；构建 exit 0，307 modules，1.72 秒。现有 React act 提示及 >500 kB chunk 提示保留。
- create-visual 聚焦测试 **11/11**，既有 4 项保留，新增 7 项：schema/类型/校验器一致性 1；形状/引用错误说明与无非法落库 5；错误回传后第二次成功 1。
- 一致性测试使用 Required<VisualNode/VisualEdge/VisualGroup> 的完整样本；按工具声明的属性构造 scene，交给真实 validateVisualScene；逐项删字段核对 required 与运行校验的一致性，额外核对字段类型、数量限制、data 标量类型和非空白语义。全量检查后补强了此测试的字段类型/空白断言，最终文件再次聚焦 11/11 和 server tsc exit 0。
- 注入 provider 的实际事件顺序：
  `visual_placeholder → visual_error → visual_placeholder → visual_ready`。
  第二轮从 tool 消息读取到 source、target、nodes[].id 说明；三轮工具对话（两次 create_visual + 最终文本）结束，节点 complete，产物可从 repo 读回且等于 ready.artifact。
- 起点与终点 packages 全文件 SHA256 对比：仅 create-visual.ts、create-visual.test.ts 两文件变化，零删除；R25/R26 产物与所有禁改路径字节保持不变。

## 边界与 Hub 验收事项

- fake provider 证明反馈管道和第二次调用能成功，不证明真实模型会按反馈自纠，也不提供失败率估计。本轮没有调用外部模型；Hub 按合同用真实 Anthropic 问题确认 visual_ready。
- answer-service 既有 system 提示要求创建失败时用文字降级，工具 description 的文字兜底要求也保留；模型可能选择直接文字回答。两次 visual 调用额度未改，错误尝试仍消耗额度。
- schema 能展示字段和类型，但不能阻止模型生成不存在的引用、重复 id、超限或危险内容；这些失败仍由既有校验器返回。没有发现精确化后“仍高频失败”的实测证据，不能从单个 fake 流程推断真实成功率。
- 未重启/杀服务、未修改真实 DB/vault、未提交或推送。当前运行服务是否加载本轮改动，以及活体生成质量，由 Hub 最终验收。

