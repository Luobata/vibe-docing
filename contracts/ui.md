# Contract · ui（Round 8 · 代码块 Notion 化：预览 + 编辑）

- Hub 分派时间：2026-08-22（Round 1–7 均已验收）
- 状态：**active**
- 回复路由：`node "/Users/bytedance/Documents/gpt/gsb-local/bin/relay.mjs" send hub progress|blocker|result '<payload-json>'`，发送后 `bash "/Users/bytedance/Documents/gpt/gsb-local/bin/nudge" hub`

## 1. Objective

用户反馈：**预览与编辑里的代码块样式丑陋**。现状：
- 预览 `.doc-body pre`（Workbench.css:1092）：`--surface-sunk` 底 + **1px 边框** + r3 —— 生硬的"贴边盒子"感；行内 code（:1083）也带边框，成"描边小方块"，拥挤。
- 编辑态（Round 4 后正文 sans 16px）：``` 围栏内的代码行与普通正文完全同款，无任何视觉区分。

**目标（Notion 代码块设计语言）**：无描边、暖纸色底、等宽小一号、圆角 6px，行内代码用 Notion 标志性的暖红字 + 无边框浅底。

## 2. Scope

**写（唯一写入者）**：
- `packages/web/src/components/Workbench.css`
- `packages/web/src/editor/MarkdownEditor.tsx`（**仅新增 CodeMirror 围栏行装饰扩展 + import**，不碰既有逻辑/handler；参照 Round 4 的"仅样式"口径）
- `packages/web/src/editor/DocumentEditor.test.tsx` 或新增测试（装饰断言）

禁触：server/shared/api/state/vite/package.json；无 git 操作；无新依赖。

**规格**：

A. **预览（阅读视图）**：
1. 新增 token：`--code-bg: #F7F6F3;`（Notion 暖纸色）与 `--code-ink: #EB5757;`（行内代码字色）入 :root。
2. `.doc-body pre`：去掉 1px 边框；`background: var(--code-bg)`；`border-radius: var(--r2)`；`padding: 16px 20px`；`margin: 1.1em 0`；内部 `pre code` 字号 `.84em`、行高 1.55、`font-family: var(--mono)`。保留 overflow-x 与既有细滚动条。
3. 行内 `.doc-body code`（非 pre 内）：去边框；`background: rgba(135,131,120,.15)`；`color: var(--code-ink)`；`border-radius: 3px`；`padding: .15em .35em`；字号 `.85em`；mono。
4. 同步 `.version-diff pre`（若存在同类描边）与分享渲染若有共享类（share 页面如独立样式表则不动，报告说明）。

B. **编辑态（CodeMirror markdown）**：
1. MarkdownEditor 新增一个 ViewPlugin：从文档首行扫到末行，状态机识别 ``` 围栏（含 ```lang 开行到闭合 ``` 行，含起止行），对围栏内所有行加 line decoration class `cm-code-line`。
2. CSS（Workbench.css，作用域 `.document-editor-surface`）：`.cm-code-line { font-family: var(--mono); font-size: 13.5px; line-height: 1.55; background: var(--code-bg); }`；围栏起止标记行（``` 行本身）文字 `--text-3`（可用同一 class 加弱化变体或单独 class `cm-code-fence`）。
3. 未闭合围栏（文档末尾未结束的 ```）：打开状态即装饰到末行（所见即所得常见行为）。
4. 性能：doc 变化时重算（buildDecorations 基于 visible range + 保守全量也可，文档量级为笔记级，可接受）；不要每 keystroke 全文档 O(n²)。
5. reduced-motion / 暗色：本项目仅浅色，无需处理。

C. **测试**：编辑态渲染含 ``` 围栏的文档，断言围栏行存在 `.cm-code-line` 装饰、普通正文行无；预览态断言 pre 无 border 类样式（jsdom 读 computed 有限，可断言 style 规则存在/类名生效即可，保留语义）。

## 3. Validation（done-when）

1. `pnpm --filter @vibe/web typecheck` / `test` / `build` 全通过（260 既有零删除）。
2. result 附：文件清单、命令输出摘要、A/B 自查各 2-3 行、caveats。

## 4. Stop conditions

- ViewPlugin 装饰在 jsdom 测试环境不可断言（CodeMirror 环境问题）→ 用最小 headless 验证思路改为代码审查 + Hub 浏览器复核，测试退化为"扩展注册不报错"级别，caveats 说明。
- 发现围栏识别与既有 markdown 渲染冲突 → blocker。

## 5. Reply route

- 完成发 result（一次）+ nudge hub。
