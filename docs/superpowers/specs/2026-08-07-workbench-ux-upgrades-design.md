# 工作台 UX 升级设计（8 项）

- 日期：2026-08-07
- 状态：待评审
- 范围：`packages/web`（主要）、`packages/server` + `packages/shared`（笔记落库、合并展示所需接口）

## 背景与目标

树形对话工作台当前为三列布局（左：树导航；中：主文档 + 对话；右：派生分支）。本次收敛 8 项来自使用中的改动诉求，分两期推进：

- **第一期（功能与结构，#1–#7）**：每项独立、可测。新增运行态尽量进 `workbench-store`（单一 store），避免组件内 `useState` 在切换时丢失。
- **第二期（视觉，#8）**：在 #1–#7 落地后的最终 DOM 上，由设计师做**全面视觉改版**。放在最后是为了避免对移动中的目标反复调整样式。

## 现状调研结论（事实）

- **三列宽度**写死在 `Workbench.css:13` 的 `grid-template-columns`，无拖拽把手；聚焦模式切 2 列（`Workbench.css:18-20`）。
- **右栏 `SubdocTabs`** 只把**子节点（派生/fork）**渲染成 tab（`workbench-store.ts` 的 `computeChildTabs` 仅取 `parent_id === 当前` 的节点）。
- **笔记当前是空操作**：`MainDoc.tsx:290` 的 `onCreateNote={() => setSelection(null)}` 只关气泡，不落库、不展示。
- **合并瞬时态是组件内 `useState`**：`MergeButton.tsx:14-16` 的 `busy`/`merged` 绑定当前子 tab；切 tab 后 `sourceNodeId` 变化、状态丢失。
- **合并结论未在前端展示**：`merge-service.ts:42-62` 把提炼结论写成父节点的 `context_segments`（`type='merged-conclusion'`）+ 版本快照；`getNode` 返回 `segments`，但 web 端**零处渲染** segments。→ 真实 gap，非测试数据问题。
- **根节点无删除按钮**：`TreePanel.tsx:52` 删除按钮仅在 `node.parent_id` 存在时渲染；根（无 parent）没有。删树能力已存在：`api.deleteTree`（`client.ts:85`）+ `tree-repo` 软删（`tree-repo.ts:54`）+ `TreeLauncher.tsx:60` 已有「删除树（可回收站恢复）」。
- **气泡触发靠选区**（mouseup/keyup → `setSelection`，`DocView.tsx:42-43`）；代码中**无任何 `onContextMenu`**。
- **数据模型**：`annotations` 表已含 `kind, anchor_from, anchor_to, quoted_text, note, child_node_id`（`schema.sql:27`）。→ **笔记 = `child_node_id` 为空的批注；派生 = 带 `child_node_id` 的批注**。无需新增 `AnnotationKind`。

## 决策（已确认）

- #2 笔记：**列表 + 点击回跳高亮**。
- #5 删根：**删根 = 删整棵树到回收站**（复用现有 `deleteTree`）。
- #7 右键：**右键弹小菜单 → 再展开对应输入气泡**（取消「选中即弹」）。
- #8 设计：**全面视觉改版**，最后阶段进行。

---

## 分项设计

### #1 三列可拖拽宽度

- 在「左|中」「中|右」之间插入两个拖拽把手 `<div role="separator" aria-orientation="vertical">`。
- `grid-template-columns` 改用 CSS 变量：`var(--col-left) minmax(360px,1fr) var(--col-right)`（中列自适应）。拖动把手更新 `--col-left` / `--col-right`（像素或 fr，取像素更直观）。
- 约束：每列 min/max 夹取（左 ≥180px，右 ≥260px，任一列 ≤ 视口 50%）。
- 持久化：宽度写 `localStorage`（key 如 `workbench.cols`），加载时恢复。
- 交互：把手可键盘聚焦，←/→ 以 16px 步进调整；双击复位默认。
- 聚焦模式（2 列）隐藏把手，不读取自定义宽度。
- 组件：把手逻辑抽到 `useColumnResize` hook + 在 `Workbench.tsx` 渲染把手；宽度状态用本地 hook（不进全局 store，纯视图偏好）。

### #2 右侧双 Tab：派生分支 / 笔记

**顶层 Tab 切换**：右栏加一层「派生分支 | 笔记」Tab（新组件 `SubdocPanelTabs`，包住现有 `SubdocTabs` 与新 `NotesTab`）。当前哪个 tab 存本地 state 即可。

**先补齐笔记落库**（修空操作）：

- 后端：新增「创建批注（不 fork）」能力。方案：新增 `POST /api/nodes/:id/annotation`，body `{ anchorFrom, anchorTo, quotedText, note }`，调用 `annotations.create({ kind:'selection', childNodeId:null, ... })`，返回 `{ annotation }`。（`fork` 恒建子节点，不复用。）
- shared/client：新增 `api.createNote(nodeId, { anchorFrom, anchorTo, quotedText, note })`。
- `MainDoc.tsx`：`onCreateNote` 改为调用 `api.createNote`，成功后把返回的 annotation 追加进 `annotations` state（正文高亮立即生效，复用现有 `renderAnnotatedHtml`）。

**笔记 Tab 展示 + 回跳**：

- `NotesTab` 读取当前主文档的 `annotations` 中 `child_node_id == null`（纯笔记）的项，列出「引用原文（quoted_text）+ 笔记（note）」。
- 点击某条 → 通知主文档滚动到该 annotation 的 `anchor` 位置并高亮。实现：主文档已有按 annotation 渲染 `<mark data-ann-id>`；点击笔记时 `document` 内 `querySelector('[data-ann-id="..."]')` → `scrollIntoView` + 短暂高亮类。需要一个从右栏到主文档的通道：在 store 加 `focusedAnnotationId: string | null` + `setFocusedAnnotation(id)`；主文档 `useEffect` 监听并滚动/高亮。
- 空态：「还没有笔记」。

> 注：派生（fork）也会产生一条带 `child_node_id` 的 annotation。派生 Tab 仍按现有 `computeChildTabs`（子节点）渲染，不改数据来源；笔记 Tab 只看纯笔记 annotation。两者互不影响。

### #3 修复「合并中/已合并」切 tab 丢失

- 在 `workbench-store` 增 `mergeStateByNodeId: Record<string, 'merging' | 'merged'>` 及 `setMergeState(nodeId, state)`。
- `MergeButton` 不再用本地 `useState` 记 `busy/merged`，改为按 `sourceNodeId` 读写 store。切 tab 回来按节点 id 读取，状态保留。
- 合并失败仍用局部 error 提示即可（瞬时、可重试），不必进 store。

### #4 补合并结论在父文档的展示

- `getNode` 已返回 `segments`。在 `MainDoc` 主文档正文下方新增「合并结论」区块（新组件 `MergedConclusions`），渲染当前主文档节点的 `segments.filter(type==='merged-conclusion')`：显示来源子分支标题（`ref_node_id` → nodeTitle）+ 结论内容（`content`，按 Markdown 渲染）。
- `MainDoc` 的 `getNode` 结果已有 `annotations`；同步保存 `segments` 到局部 state 并传给该区块。
- 合并成功后（#3 的 `merged`）刷新主文档 segments，使父文档即时看到结论。

### #5 根节点可软删除（= 删整棵树）

- `TreePanel` 的 `TreeBranch`：根节点（无 `parent_id`）也渲染删除按钮，但走**删树**语义。
- 点击根删除：`window.confirm('将删除整棵树"…"，可在回收站/树列表恢复。')` → 调 `api.deleteTree(treeId)`；成功后 `reset()` 或跳回树列表空态。
- 非根节点：维持现有子树级联软删（`api.deleteNode` + `setSubtreeDeleted`）。
- 复用 `TreeLauncher` 已有的删树恢复路径，不新建后端能力。

### #6 聚焦切换动画

- 给 `.workbench` 的 `grid-template-columns` 及左右栏（`.tree-panel`/`.subdoc-panel`）的透明度/位移加 `transition`（~240ms ease）。进入/退出聚焦时平滑收合而非瞬跳。
- 用 `@media (prefers-reduced-motion: reduce)` 关闭动画。
- 注意 `hidden` 属性会瞬时移除元素——聚焦隐藏改用 CSS（`data-focus` 下设宽度 0 + `opacity`/`visibility` 过渡）而非 `hidden`，以获得动画；保留可访问性（结束后 `visibility:hidden` / `aria-hidden`）。

### #7 右键呼出小菜单

- 正文 `doc-body` 加 `onContextMenu`：**有选区时** `preventDefault()`，在鼠标坐标处弹轻量菜单（`ContextMenu` 组件，`role="menu"`）：「笔记」「就此展开」。
- 选项点击 → 展开对应输入。沿用现有 `AnnotationBubble`，但由菜单选择决定初始聚焦：选「笔记」聚焦笔记输入、选「就此展开」聚焦追问输入。气泡结构不拆分（保留双输入），仅改由菜单驱动展示与初始焦点。
- 移除「选中即弹气泡」：`DocView` 仍捕获选区（供锚点/坐标），但不再自动展示气泡；由右键菜单驱动。
- 关闭：点击别处 / Esc / 选择某项后。键盘可达（菜单项可 Tab/↑↓）。

### #8 全面视觉改版（最后阶段）

- 在 #1–#7 完成后，由 `oh-my-claudecode:designer` 对以下做统一视觉与交互升级：三列 + 拖拽把手、右栏双 Tab、笔记列表、合并结论区块、右键菜单、聚焦动画、气泡。
- **风险提示**：用户选择「全面改版」，设计师可能重新定义配色/排版，可能偏离现有暖色纸感。流程上要求：**先出方向（少量关键界面的视觉预览）经确认，再整体落地**，便于回退。
- 交付以真实渲染截图人工确认为准。

---

## 测试策略

- #1：`useColumnResize` 单测（夹取、持久化读写、复位）。
- #2：`createNote` 端到端（后端路由单测 + client）；`NotesTab` 列表渲染与点击派发 `setFocusedAnnotation`；主文档收到后滚动/高亮（jsdom 下断言 mark 存在与高亮类）。
- #3：store `mergeStateByNodeId` 语义单测；`MergeButton` 切换 sourceNodeId 后读回状态。
- #4：`MergedConclusions` 按 `segments` 过滤/渲染单测。
- #5：根删除走 `deleteTree` 的分支单测（confirm、调用、回退）。
- #6：CSS 动画以视觉/手动确认为主；`prefers-reduced-motion` 分支检查。
- #7：`onContextMenu` 有/无选区行为、菜单项触发对应输入、关闭路径单测。
- 全量：`pnpm --filter @vibe/web test` + `pnpm --filter @vibe/server test` 保持全绿；`tsc --noEmit` 干净。

## 分期与依赖

1. #3、#4（合并相关，改动集中、风险低）
2. #2（笔记：后端接口 + 右栏双 Tab + 回跳）
3. #5（删根 = 删树）
4. #1（拖拽）、#6（聚焦动画）、#7（右键菜单）——纯前端交互
5. #8 视觉改版（依赖以上全部完成）

## 非目标（YAGNI）

- 笔记的编辑/删除（本期只做「创建 + 列表 + 回跳」；用户已选「列表 + 回跳」而非「可编辑/删除」）。
- 合并结论的反向编辑或撤销。
- 拖拽宽度的多布局预设 / 跨设备同步（仅 localStorage 本地持久化）。
