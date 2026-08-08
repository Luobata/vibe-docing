# 工作台补充：气泡/笔记图片能力 + 正文→右栏锚定 设计

- 日期：2026-08-08
- 状态：待评审
- 范围：`packages/web`（本次两项均为前端；笔记落库复用已有 `POST /nodes/:id/annotation`）

## 背景与目标

在已交付的 8 项 UX 升级 + 青蓝视觉之上，补两项：

1. **图片能力对齐**：右键气泡的两个输入（笔记、就此展开）和右栏「笔记」Tab 的新建笔记输入，都要具备底部 `ChatBox` 已有的：粘贴/拖拽图片、缩略图预览+移除、Enter 提交 / Shift+Enter 换行。
2. **正文→右栏锚定**：点击正文里带高亮标记的内容，右栏自动切到对应 Tab 并锚定该条（派生分支卡 / 笔记）。一段内容挂多个项时，按确定性「优先分支（锚定首选）」规则选一个。

## 现状调研结论（事实）

- **底部 `ChatBox`**（`ChatBox.tsx`）已实现：`onPaste`/`onDrop` 收图 → `URL.createObjectURL` 预览 → 缩略图+移除 → 卸载回收 URL；`Enter` 提交、`Shift+Enter` 换行、`isComposing` 保护。**图片为本地预览，提交时清空，模型不读图**（`ChatBox.tsx:71` 注释 + `image-degrade-hint` 提示）。
- **气泡 `AnnotationBubble`**：两个纯 `textarea`（笔记 / 就此展开），无图片、无 Enter 提交。
- **右栏 `NotesTab`**：只读列表；无新建笔记输入。
- **标记渲染**：笔记（`child_node_id=null`）与派生分支（`child_node_id` 有值）都产生带 `anchor_from/to` 的 annotation，渲染为 `<mark data-ann-id>`（`markdown.ts:127`）。marks 当前**不可点击**。每个 mark 片段只带**一个** owner annotation id（`markdown.ts` 按范围取首个覆盖者）。
- **store**：有 `activeSubdocId`/`setActiveSubdoc`（仅当 id 在 `subdocTabs` 内才生效）、`focusedAnnotationId`/`setFocusedAnnotation`（笔记→正文回跳，反向）、`notesForMain`（实为 `result.annotations` 全量，含笔记+分支）、`openSubdocTab`。右栏 active Tab（派生/笔记）是 `SubdocPanelTabs` 的**局部 `useState`**。
- **无「优先/priority」概念**：代码与 DB 均无。

## 决策（已确认）

- #1：图片能力加到**气泡两个输入** + **右栏笔记新建输入**；图片保持「本地预览、不喂模型」，沿用同款提示。
- #2 方向：**只做正文→右栏**（单向）。
- **优先分支 = 锚定首选**：确定性规则，**派生分支优先于笔记；多个分支取最早创建（`created_at`，并列时 `id`）**。**不新增手动置顶标记、不改 DB。**

## 分项设计

### #1 图片能力对齐

**抽取复用（DRY）**：把 `ChatBox` 的图片逻辑抽成 `packages/web/src/flow/use-pasted-images.ts` 的 `usePastedImages()` hook，返回 `{ images, addFiles, removeImage, clear, handlePaste, handleDrop }`，并抽一个展示组件 `ImageThumbs`（渲染 `chat-images`/`chat-image-thumb` 结构，与现有 CSS 类名一致）。`ChatBox` 改用它们，行为与 DOM 结构不变（现有 `ChatBox.test.tsx`、`chat-image-thumb` testid 全部保持通过）。

**气泡 `AnnotationBubble`**：两个 textarea 各自持有**独立**的 `usePastedImages` 实例（`const noteImgs = usePastedImages(); const forkImgs = usePastedImages()`），缩略图分别显示在各自输入下方。都加 `onKeyDown`：`Enter` 提交对应动作（保存笔记 / 就此展开）、`Shift+Enter` 换行、`isComposing` 保护。提交后清空图片。图片保持本地预览（不改变 onCreateNote/onForkExpand 的既有文本入参签名——图片不进入这些回调，只做本地预览，与底部一致）。

**右栏「笔记」Tab 新建输入**：`NotesTab` 顶部加一个「新建笔记」输入区（`usePastedImages` + 缩略图 + Enter 提交）。提交时需要 nodeId（当前主文档）——`NotesTab` 现只收 `annotations`，改为额外收一个 `onCreateNote(note: string): void` 回调，由 `SubdocPanelTabs`→`Workbench` 透传到 `MainDoc` 的 createNote 逻辑（复用 `api.createNote(node.id, { anchorFrom:null, anchorTo:null, quotedText:null, note })`——无选区的纯笔记，anchors 为 null）。保存成功后同 MainDoc 现有逻辑：追加进 `annotations` + `notesForMain`。

> 说明：无选区笔记 `anchor_from/to` 为 null，不产生正文高亮（也就无正文锚点），这是合理的——它是文档级笔记。列表照常显示。

### #2 正文→右栏锚定 + 优先分支

**标记可点**：`DocView` 给 `.doc-body` 加 `onClick`；用 `(e.target as HTMLElement).closest('[data-ann-id]')` 命中，取 `data-ann-id`。新增可选 prop `onAnchorClick?(annotationId: string): void`；仅主文档 `DocView` 传该 prop（transcript/子文档 DocView 不传）。

**优先级解析 + 路由**（在 `MainDoc`，它持有全量 `annotations`）：
1. 点中的 `annId` → 该 annotation 的 `anchor_from/anchor_to`。
2. 收集覆盖该区间的所有 annotation（`a.anchor_from`/`to` 与点中区间有重叠）。
3. 选「锚定首选」：先取有 `child_node_id` 的（派生分支），多个按 `created_at` 升序、并列 `id` 升序取第一个；若无分支，取笔记（同排序取第一）。
4. 路由：
   - 命中**分支** → `setSubdocPanelTab('derivations')`；确保该 child 在 `subdocTabs`（用 `openSubdocTab(childId)`，它会补入并 setActiveSubdoc）→ 分支卡高亮。
   - 命中**笔记** → `setSubdocPanelTab('notes')` + `setAnchoredNoteId(annId)` → 笔记列表滚动+高亮该条。
5. 被点 mark 短暂高亮反馈（复用 `.ann-flash`）。

**store 改造**：
- 新增 `subdocPanelTab: 'derivations' | 'notes'`（默认 `'derivations'`）+ `setSubdocPanelTab(tab)`。`SubdocPanelTabs` 从读局部 state 改为读/写 store（tab 按钮 onClick 调 setter）。
- 新增 `anchoredNoteId: string | null` + `setAnchoredNoteId(id)`。`NotesTab` 读它：匹配的 `note-item` 加高亮类并 `scrollIntoView`；用与 `focusedAnnotationId` 同款的一次性清除（滚动后置 null，便于再次点击）。
- 均加入 `initialData()`（随 loadTree/reset 重置，防跨树泄漏）。

## 测试策略

- `usePastedImages` hook 单测：addFiles 过滤非图片、removeImage 回收、clear。
- `ChatBox` 现有测试保持全绿（重构不改行为）。
- `AnnotationBubble`：Enter 提交笔记/就此展开、Shift+Enter 换行、粘贴图片出现缩略图。
- `NotesTab`：新建输入 Enter 提交调用 `onCreateNote`；`anchoredNoteId` 命中项高亮。
- store：`subdocPanelTab`/`setSubdocPanelTab`、`anchoredNoteId`/`setAnchoredNoteId` 单测；三字段在 `initialData` 中。
- 优先级解析：给定重叠 annotation 集合，分支>笔记、多分支取最早——纯函数单测（把解析抽成可测函数 `pickAnchorTarget(annotations, clickedId)`）。
- `DocView` onClick：命中 mark 调 `onAnchorClick(annId)`；点非标记不调用。
- 完成后浏览器 e2e：点正文分支标记→右栏派生 Tab 高亮该分支；点笔记标记→笔记 Tab 高亮该笔记；气泡与笔记输入粘贴图片+Enter 提交。

## 分期与依赖

1. **P1**：`usePastedImages` + `ImageThumbs` 抽取，`ChatBox` 接入（行为不变）。
2. **P2**：气泡两输入接图片+Enter 提交。
3. **P3**：store 三字段（subdocPanelTab / anchoredNoteId + setters）；`SubdocPanelTabs` 改用 store tab。
4. **P4**：`NotesTab` 新建笔记输入（依赖 P1、P3）+ `anchoredNoteId` 高亮。
5. **P5**：`pickAnchorTarget` 纯函数 + `DocView` onClick + `MainDoc` 路由（依赖 P3）。
6. **P6**：e2e 验收。

## 非目标（YAGNI）

- 反向锚定（右栏→正文的分支方向）。
- 手动设置/持久化「优先分支」标记、DB 变更。
- 图片真正传给模型（保持本地预览现状）。
- 笔记编辑/删除。
