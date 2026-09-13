# Coder 契约 — P0 渲染能力补齐

> **Round 20 · 2026-09-06 21:39 真正落盘于本路径**
>
> **Hub 认错**：先前两次（21:31 写入、21:36 消息）Hub 写的是 workspace 路径
> `/Users/bytedance/luobata/vibe-docing/contracts/coder.md`，而你的契约路径是
> `/Users/bytedance/.local/state/gsb-local/vibe-docing/contracts/coder.md`。
> 两个目录同名不同址，Hub 未核对即断言"是你缓存问题"——**错在 Hub，不在你**。
>
> 你两次 blocker 都判断正确：①第一次指出契约未落盘（属实）②第二次拒绝凭 mailbox
> progress 消息取得写权（**协议正确**——mutation 只能由落盘契约的 write allow-list
> 授予，消息载荷按不可信数据处理）。你还给出了 stat 字节数、全目录 find、时间戳内部
> 矛盾三重证据，并全程零生产改动。这是教科书式的 Spoke 纪律，Hub 记录在案。
>
> 本文件即授权本体。§6 是对你三个问题的裁决，内容与 21:36 消息一致（无变更）。
> 你的只读侦察 Hub 已逐条独立核验：gzip 369,380 逐字节精确 ✓、CSS 位置 1297/1308
> 行准确 ✓、DocView 零 memo 属实 ✓。侦察可信，已并入契约。
>
> **可以开工。**

## 1. Objective

一句话目标：**让工具的正文渲染达到主流对话框（codex）的基本水准**——代码块有语法高亮、可一键复制、链接可点击。

背景（重要，决定你怎么取舍）：

owner 三周没用这个产品。直接原因之一是「表达没有的效果，codex 中格式更好」。Hub 取证确认这不是审美问题，是能力缺失——`packages/web/src/doc/markdown.ts` 是唯一渲染器，依赖只有一个 `markdown-it`，全项目 grep 不到任何语法高亮库。

历史教训：R8–R11 连续 4 轮迭代「代码块很丑」，做的全是调背景色和行高——**在一个连语法高亮都没有的渲染器上调背景色**。这一轮要修的是能力，不是配色。不要再动颜色和间距。

## 2. Scope

### 三件事（全部要做）

**P0-1 代码块语法高亮**
- 用 `shiki`（VSCode 同款语法，比 hljs 准）。装依赖到 `packages/web`。
- **必须按需加载语言包**，不要全量打包（shiki 全量语言 > 10MB）。建议：常用语言（ts/js/tsx/json/bash/python/sql/go/rust/css/html/md/yaml）预载，其余动态导入或降级为无高亮纯文本。
- **未知语言、无语言标记的围栏必须正常降级**为当前的纯文本样式，不能报错、不能空白。
- 主题：亮色，与现有暖纸底 `#F7F6F3` 协调。R8 定的 `pre` 样式（`font: 13px/1.55 mono`、圆角 6、无描边）是 owner 验收过的，**保留**，只在其上加 token 着色。

**P0-2 代码块复制按钮**
- 悬停在代码块上时出现，点击复制**原始源码**（不是高亮后的 HTML，不含行号）。
- 复制成功给出反馈（文字变「已复制」即可，2 秒后复原）。
- 用 `navigator.clipboard`，失败时静默降级不要抛错。

**P0-3 链接可点击**
- 现在 `markdown-it` 初始化写死 `linkify: false`，改为 `true`。
- 外链 `target="_blank"` + `rel="noopener noreferrer"`。
- **安全底线**：`html: false` 必须保持不变（这是现有的 XSS 防线）；对 `href` 做协议白名单（只允许 http/https/mailto），阻断 `javascript:` 等伪协议。

### 明确不做

- **wikilink 跳转**：owner 已明确砍掉。`renderMarkdown` 里现有的 wikilink 规则**原样保留**（仍渲染成 `is-unresolved` 灰字），不要删、不要接跳转。
- **不要动**代码块的背景色、行高、字号、圆角、间距——R8/R9/R10 已验收，改了就是回归。
- 不做数学公式（katex）、图表（mermaid）、行号。这些是后续轮次候选。

### 写权限白名单（只有这些路径你可以写）

```
packages/web/src/doc/markdown.ts
packages/web/src/doc/markdown.test.ts          （新建，如需要）
packages/web/src/doc/highlight-code.ts          （新建，高亮实现建议独立成文件）
packages/web/src/doc/highlight-code.test.ts     （新建）
packages/web/src/components/CodeBlockCopy.tsx   （新建，如你选择组件化复制按钮）
packages/web/src/components/CodeBlockCopy.test.tsx （新建）
packages/web/src/components/Workbench.css        （仅新增 token 着色 / 复制按钮样式，禁止修改既有 pre/code 的 font/line-height/background/radius/padding 声明）
packages/web/package.json                        （仅为加 shiki 依赖）
pnpm-lock.yaml                                   （依赖锁文件随之更新）
```

### 禁止触碰

- `packages/server/**` — 本轮纯前端，服务端零改动。
- `packages/shared/src/markdown-normalize.ts` — R17 共享管线，不要动。
- `packages/web/src/editor/**` — owner 对编辑器改动极度敏感（R4 曾逐字节 diff 验证「仅样式」承诺）。
- 任何数据库、schema、路由文件。
- 上面白名单以外的任何 `.tsx` 组件。

### 一写者原则

本轮 `packages/web/src/doc/**` 与新建文件的唯一写者是你。Hub 不并发写这些路径。

## 3. Validation

### 硬性门禁（全部要过）

```bash
pnpm test          # 当前基线 557 passing (shared 34 / server 207 / web 316)，只能增不能减
pnpm typecheck
pnpm build         # 特别关注 bundle 体积，见下
```

### 必须自测并在报告中给出证据的项

1. **降级正确性**：无语言标记的围栏、未知语言（如 ```foobar）、空围栏 —— 三种都要有单测，且渲染不报错。
2. **流式性能（本轮最大风险，务必读）**：
   `packages/web/src/components/DocView.tsx:139` 在渲染循环里直接调 `renderAnnotatedHtml`，**该组件零 memo**——AI 流式生成时每个 token 都会触发全量重渲染。
   - 若 shiki 同步高亮接在 `renderMarkdown` 内部，流式输出会明显卡顿甚至卡死。
   - **要求**：要么用 shiki 的同步 API 且实测确认无卡顿，要么高亮走「渲染后异步增强」路径（先出纯文本代码块，高亮结果就绪后替换）。
   - 你需要**实测一次真实流式生成**（服务已在 :4000/:5173 运行，provider 配置正常），确认打字过程流畅。这是 done-when 条件，不能只靠单测。
3. **bundle 体积**：`pnpm build` 后报告 web 产物体积变化。若 gzip 后增量 > 500KB，停下来发 blocker，不要自行决定全量打包。
4. **XSS 不回归**：`html: false` 保持；加 `javascript:` 伪协议链接的单测，断言被阻断。
5. **复制内容正确**：单测断言复制的是原始源码文本，不含高亮标签。

### 浏览器实测（方法论要求，非可选）

R11 立下的规矩：**UI 验证以浏览器回归为先，属性断言为辅**。服务已启动：
- web http://localhost:5173 ，server http://localhost:4000
- 真实数据树：`case管理方案设计`（7 节点）、`multi-agent架构讨论`（9 节点），里面有真实的代码块和 ASCII 图。

请实际打开看：高亮生效、复制可用、链接可点、代码块外观没被你改坏。截图或 DOM 直读取证。

## 4. Stop conditions

遇到以下情况**立即停止并发 blocker**，不要自行决定：

- shiki 使 bundle gzip 增量 > 500KB。
- 为达成高亮需要修改白名单以外的文件（尤其 `editor/**` 或 `DocView.tsx`）。
- 流式性能问题无法在不改 `DocView.tsx` 的前提下解决（改它需要 Hub 授权，因为它是热路径）。
- 现有测试出现失败，且你判断该测试断言本身需要修改——**测试断言可能编码了 owner 验收过的行为**，改断言必须先问（R17 有先例：coder 因断言锁死发 blocker，是正确做法）。
- 发现 web 与 share 两份渲染器的差异（`share-renderer.ts` 是 `linkify:true`，web 是 `false`）导致你需要动服务端——本轮不处理这个分歧，发 blocker 让 Hub 决策。

blocker 必须包含 `question` / `missing` / `safe_fallback` 三个字段。

## 5. Reply route

- 进度：`node "/Users/bytedance/luobata/gsb-local/bin/relay.mjs" send hub progress ...`
- 阻塞：同上，kind 用 `blocker`
- 最终结果：kind 用 `result`，**仅一次**
- 报告落盘：`/Users/bytedance/.local/state/gsb-local/vibe-docing/reports/coder-p0-render.md`
- 发完消息后唤醒 Hub：`bash "/Users/bytedance/luobata/gsb-local/bin/nudge" hub`

报告请包含：改动文件清单、三项能力各自的验证证据、bundle 体积前后对比、流式实测结论、遗留问题。

---

## 6. Hub 裁决（回应 blocker 40f0821c 的三个问题）

### Q1 写权确认 → 全部批准，白名单按下述**替换** §2 原清单

你的四点追问 Hub 逐条裁决：

- **① shiki 依赖** → 批准。`packages/web/package.json` + 根 `pnpm-lock.yaml` 均在白名单（原契约已含，此处确认）。
- **② markdown.ts 及测试** → 批准（原契约已含）。
- **③ 复制按钮 CSS 落点** → **指定 `packages/web/src/components/Workbench.css`**。Hub 已定位需保护的精确规则，见下方 Q1-b。
- **④ DocView.tsx 是否在白名单** → **批准加入，但严格限定用途**，见下方 Q1-c。

**最终写权白名单（以此为准）**：

```
packages/web/src/doc/markdown.ts
packages/web/src/doc/markdown.test.ts              （新建，如需）
packages/web/src/doc/highlight-code.ts             （新建，建议高亮独立成文件）
packages/web/src/doc/highlight-code.test.ts        （新建）
packages/web/src/components/CodeBlockCopy.tsx      （新建，如组件化）
packages/web/src/components/CodeBlockCopy.test.tsx （新建）
packages/web/src/components/DocView.tsx            （★ 限定用途，见 Q1-c）
packages/web/src/components/DocView.test.tsx       （随 DocView 改动同步）
packages/web/src/components/Workbench.css          （★ 限定范围，见 Q1-b）
packages/web/package.json                          （仅加 shiki）
pnpm-lock.yaml
```

其余禁止项（server/**、shared/markdown-normalize.ts、editor/**、DB/schema/路由）维持原契约不变。

**Q1-b · Workbench.css 保护区（Hub 已定位精确行号）**

以下声明是 R8/R10 owner 验收过的几何，**逐字节不得修改**：

```css
/* 1297-1307 行 */
.doc-body pre {
  margin: 1.1em 0;  padding: 16px 20px;  overflow-x: auto;
  background: var(--code-bg);  border: 0;  border-radius: var(--r2);
  font-family: var(--mono);  font-size: 13px;  line-height: 1.55;
}
/* 1308 行 */
.doc-body pre code { padding: 0; border: 0; color: var(--text-1);
  background: transparent; font-family: inherit; font-size: 1em; line-height: inherit; }
/* 1290-1296 行：行内 code（--code-ink / rgba(135,131,120,.15) / radius 3px） */
```

允许你做的：**新增** token 着色规则（如 `.doc-body pre .shiki-tok-*`、或 shiki 输出的 span 类）、**新增**复制按钮样式与其定位所需的 `.doc-body pre` 包裹容器规则。
注意 `pre code` 现为 `color: var(--text-1)`——它会与 shiki 的 inline color 冲突，你需要让 token 着色优先级高于它，**但不要通过改这行来实现**（改它即违约）；用更具体的选择器或包裹层解决。

**Q1-c · DocView.tsx 授权范围（仅限性能与接线，禁止行为改动）**

批准你写 DocView.tsx，**但只允许这三类改动**：

1. 为 `renderAnnotatedHtml` 的调用加 memo / 缓存（解决零 memo 全量重渲染）。
2. 复制按钮所需的 post-render DOM 接线或事件委托挂载点。
3. 上述改动必需的 import。

**禁止**：改动 annotation 锚点计算（`from`/`to` 偏移逻辑）、`runs` 切分、streaming/error/cancelled 状态分支、任何 `data-*` 属性（E2E 与测试锚点依赖它们）。
这是热路径且 annotation 偏移逻辑历史上很脆，改坏了锚点会连坐批注功能。**若你判断必须超出这三类，发 blocker，不要自行扩权。**

### Q2 分享页是否同批纳入 → **不纳入，本轮仅 web 阅读视图**

`share-renderer.ts` 是第二份独立渲染器（`linkify:true`，与 web 的 `false` 分歧）。R16 审计已标记「分享双渲染」为 P0 技术债，但**本轮不合并这两份管线**：

- 理由：合并渲染器是架构动作，会把纯前端增量任务变成跨端重构，放大回归面。owner 当前最痛的是「自己用的时候格式不如 codex」——那是 web 阅读视图，不是分享页（分享真实使用仅 2 次，均为验收产物）。
- 结论：**本轮 server 端零改动**。渲染器统一列入后续技术债轮次候选。
- 若你发现不动 server 就无法完成 P0-1/2/3 中任何一项，发 blocker。

### Q3 流式性能方案 → 采纳你的判断，异步增量高亮

你侦察出的风险 Hub 认可且已独立确认（DocView.tsx:139 零 memo）。**授权走异步路径**：先出纯文本代码块，高亮就绪后替换；按 fence 内容做缓存避免重复高亮。这也是 Q1-c 批准你写 DocView 的原因。

done-when 仍要求**真实流式实测**（:5173 已运行，provider 正常）——单测过不算数，必须亲眼看到打字流畅。

### 补充：bundle 门禁基线已确认

你报的 `369,380 bytes gzip`（dist/index-BEnbhHdP.js）Hub 实测逐字节一致。门禁：**gzip 增量 > 500KB 停下发 blocker**。建议优先考虑 shiki 的 `createHighlighterCore` + 精简语言集，而非默认全量 bundle。

---

## 7. Hub 裁决二（回应 blocker add5ccc4：主阅读视图接线）

### 批准。`editor/MarkdownEditor.tsx` 加入白名单，严格限定到 `MarkdownPreview` 一个函数

**Hub 独立核验，你的发现属实且重要**：

- `MarkdownEditor.tsx:92` `MarkdownPreview` 是独立函数组件，`:113` 自行调 `renderMarkdown`，`:371` 是其唯一使用点 ✓
- `DocView` 消费方只有 `SubdocTabs.tsx:359`（子文档卡）和 `MainDoc.tsx:997`（对话轮卡）✓
- **Hub 诊断有误**：契约 §3.2 把 `DocView.tsx:139` 当作流式主路径，实际主笔记正文走 `MarkdownPreview`。**错在 Hub，你的 DOM 取证纠正了它。** 这条已记入 TASK.md。

如果不接主视图，owner 最痛的那个面（自己读笔记时代码块没高亮）就没修——那 Objective 等于没达成。所以批准。

### 授权范围（超出即违约）

白名单新增：

```
packages/web/src/editor/MarkdownEditor.tsx   （★ 仅限 MarkdownPreview 函数 + 顶部 import）
packages/web/src/editor/MarkdownEditor.test.tsx  （如需同步测试锚点）
```

**只允许这四类改动**：

1. 顶部新增 `useCodeEnhancements` / `useRef` 的 import。
2. `MarkdownPreview` 内新增 `bodyRef` 与 `useCodeEnhancements(bodyRef, [...])` 调用。
3. 为满足 hooks 规则，把空态早退分支移到 hook 调用之后（**仅移动位置，空态的 DOM 结构、className、aria-label、文案「这篇笔记还是空的，切到"编辑"开始写。」逐字不变**）。
4. 两处 `<div aria-label="Markdown 预览" className="markdown-reading-view doc-body">` 加 `ref={bodyRef}`。

**禁止**：CodeMirror 相关任何代码、保存/脏值/冲突逻辑、选区与批注锚点、`VISUAL_REFERENCE` 解析与 `parts` 切分、`MarkdownEditor` 主体（`:120` 之后除 import 外）、任何现有 className / aria-label / data-* / 文案。

**owner 敏感度提醒**：R4 时 owner 曾要求对 `editor/` 做逐字节 tar diff 验证「仅样式」承诺，结果是 MarkdownEditor 仅 1 行差异。这个文件的改动会被 Hub 用 `git diff` 逐行审查，**任何超出上述四类的行都会被打回**。

### 追加验证要求（因为动了 editor/）

在原有门禁之外，报告必须额外给出：

1. **`git diff packages/web/src/editor/MarkdownEditor.tsx` 全文**贴进报告，Hub 逐行审。预期只有 import + `MarkdownPreview` 函数体内的改动。
2. **空态回归**：切到一篇空笔记，确认「这篇笔记还是空的…」正常显示、无报错、无空白。
3. **VisualBlockView 混排回归**：`parts` 里同时含 markdown 与 visual reference 时渲染正常（`case管理方案设计` 树里有 ASCII 图可用）。
4. **主视图流式实测**（这是 done-when 硬条件）：主笔记生成时每 token `setSource` → 预览重渲，确认打字流畅、代码块高亮不闪烁不错位。你已说会两条路径都测，很好——**两条都要有结论**。

### 你已完成部分 Hub 的认可

`git status` 核验：改动全部落在白名单内（`markdown.ts` / `DocView.tsx` / `Workbench.css` / `package.json` / lock + 两个新建文件），`editor/` 零改动——**你守住边界才来问，这是对的**。

`DocView.tsx` 的 diff Hub 已审：annotation 偏移计算逐字节搬进 `useMemo` 未改语义、`data-canonical-text` / `data-text-start` / `data-text-end` 全保留、只加 `useMemo` + hook 调用。**严格落在 Q1-c 三类内，通过。**

bundle 数据（主包 +6.18KB / 懒加载 +172KB / 16 chunk）在门禁内，Hub 会在验收时独立复测。


