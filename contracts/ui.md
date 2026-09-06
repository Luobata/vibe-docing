# Contract · ui（Round 15 · 文件夹拖拽归档：拖动 → 确认 → 放入）

- Hub 分派时间：2026-08-23（用户需求：笔记/笔记库创建文件夹后支持拖动，**放下需确认才执行**）
- 状态：**active**
- 回复路由：`node "/Users/bytedance/Documents/gpt/gsb-local/bin/relay.mjs" send hub progress|blocker|result '<payload-json>'`，发送后 `bash "/Users/bytedance/Documents/gpt/gsb-local/bin/nudge" hub`

## 1. Objective

为两层文件夹补齐**拖拽归档**（HTML5 原生 DnD，零依赖）：
**A. 笔记库层面**（TreeLauncher）：拖笔记库行 → 放到文件夹头（或库所在文件夹行的容器）→ 确认 → `api.setTreeFolder`。
**B. 笔记层面**（TreePanel）：拖笔记行 → 放到目录头 → 确认 → `api.moveNode`（注意 file_path 真实移动）。

**核心交互契约（用户明确要求）**：drop 不直接生效——弹出 ConfirmDialog（复用现有 a11y 范本组件），文案「将「{名称}」移入文件夹「{目录}」？」，确认才调 API，取消零变更。

**Hub 已就绪 API（勿改）**：`api.setTreeFolder(treeId, folder|null)`、`api.moveNode(nodeId, directory)`（空串=根）；`dirOf` 的内部命名空间剥离逻辑（R18 补刀）——**拖拽目标目录传给 API 时注意**：moveNode 接收的是剥离后的用户目录（服务端按原名落盘 `用户目录/文件名`，这是期望行为）。

## 2. Scope

**写（唯一写入者）**：`packages/web/src/components/TreeLauncher.tsx`、`TreePanel.tsx`、`Workbench.css`（拖拽视觉）、两测试文件。**禁触**：server/shared/api/state；git；新依赖（用原生 draggable/dataTransfer）。

**规格**：
1. **可拖动**：TreeLauncher 库行、TreePanel 非根笔记行设 `draggable`；根笔记不可拖（与移动入口纪律一致）；拖动时行半透明（dragging 类）。`dataTransfer` 携带类型+id（建议自定义 MIME `application/x-vibe-item` + JSON），**仅接受同类型拖入**（拒绝外部文件拖入产生误动作）。
2. **放置目标**：目录/文件夹头（含「未分组」？——是：拖到「未分组」= 移出文件夹/移回根，确认文案相应变化）。dragover 时目标高亮（主色描边或 tint 底，token 化）；无效目标（自身、自己的子树目录、同文件夹原位）不亮且 drop 无动作。
3. **确认弹窗**：drop → ConfirmDialog（trigger=被拖行的主按钮，焦点还原失败可容忍；busy 态接 API in-flight）。确认 → 调 API → 成功后 store 更新（upsertNode / 本地 trees 重排）即时反映；失败 toast。取消 → 无任何变更。
4. **移动端**：原生 DnD 不支持触摸——现有「移入文件夹」popover 仍是触屏路径，不额外做 polyfill（caveats 注明）。
5. **键盘路径不受影响**：roving 模型与现有 popover 移动入口照旧；DnD 是鼠标增强而非替代。
6. **视觉细节**：dragstart 时源行 opacity .4；drop 目标 `.is-drop-target`（2px 主色描边 + tint）；body 在 dragover 期间可加类禁用文本选中闪烁。全 token。
7. **测试**（jsdom 的 DnD 事件可 fireEvent.dragStart/dragOver/drop 模拟）：①拖库到文件夹头→确认→setTreeFolder 以正确参数调用且本地重排；②取消→零调用；③拖笔记到目录头→确认→moveNode 调用+upsertNode；④拖到无效目标（自身子树/原位）→无弹窗；⑤外部 MIME 拒绝。≥5 个。

**质量底线**：293+ 既有测试零删除；审计"做得对的 5 条"（含 ConfirmDialog 范本、IME、焦点环）不破坏。

## 3. Validation（done-when）

1. `pnpm --filter @vibe/web typecheck` / `test` / `build` 全通过。
2. result 附：文件清单、命令输出、自查 4-5 行、caveats（含触屏说明）。

## 4. Stop conditions

- jsdom 无法可靠模拟 dataTransfer（如 setData 读不回）→ 用最小 DataTransfer polyfill 或在 handler 提取可测的纯函数 + 测试降级为逻辑级，caveats 说明，Hub 将用真实浏览器补 E2E。
- 与 roving 键盘/折叠持久化冲突 → 保键盘，DnD 降级为仅 popover 触发区外行，caveats 说明。

## 5. Reply route

- 完成发 result（一次）+ nudge hub。
