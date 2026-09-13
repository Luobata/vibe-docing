# Round 22 · plan 反证审计：显式创建目录（文件夹）功能

- 日期：2026-09-13
- 角色：plan（聚焦反证，只读，零生产代码改动）
- 审计对象：Hub 设计草案（contracts/plan.md §「Hub 设计草案」）
- 方法：全部裁决基于当前仓库源码取证（file:line），并对自研路由行为做了运行时实证。

## 摘要（TL;DR）

草案方向**正确且诚实**（服务端小表 + 并集渲染是最小改动路径，无更小的诚实实现）。**放行前必须修正 2 个"最小改动"假设错误**，否则空文件夹根本不会显示：

1. **BLOCKER-级设计缺陷**：`buildFolderTree` 第 29 行 `if (!trees.some(...folder))` 在**没有任何 tree 带 folder** 时直接返回 `null`——只有空文件夹时整个文件夹树被短路，永不渲染。草案「buildFolderTree 加 folders 入参」必须**同时改这个 guard**，不是加个参数那么简单。
2. **同源缺陷**：`trees.length > 0 &&`（第 550 行）——库全删光、只剩空文件夹时，整个列表 `<ul>` 不渲染，空文件夹连同新建入口一起消失。Q6 Hub 自己点出的怀疑**成立**。
3. **隐藏耦合**：`.tree-dir-header` 当前是**单个 `<button>`**（第 492–513 行），同时承载 toggle + drop target + `data-launch-row`。草案 item 9「文件夹头提供删除入口」**无法**在 button 内嵌 button，必须把文件夹头**重构为容器 + 两个按钮**，牵动 DnD/roving/CSS 三处。Q6「最小改动点」低估了。
4. **事实校正**：Q3 前提「自研路由」**与实际不符**——`fastify@5` 已安装（`packages/server/node_modules/fastify/package.json` 存在），生产与测试跑的是**真 fastify**，自研 fallback 只在 fastify 缺失时启用（app-instance.ts:307-309）。POST-body 的结论依然对（两种路由下都对），但理由要改。

逐条裁决如下。

---

## Q1 — 空文件夹持久化方案：服务端表 vs 替代方案

**裁决：CONFIRM（服务端表正确且不过度）。**

证据与推理：
- 现状文件夹**纯派生**：`buildFolderTree(trees)`（TreeLauncher.tsx:28）只从 `tree.folder` 字段推导，无任何独立存储。空文件夹无处落脚——这正是 owner 找不到"创建目录"入口的根因。
- 三种候选对比：
  - **A. 纯前端 localStorage**：与现有 `vibe-docing:tree-folders`（折叠态，TreeLauncher.tsx:70）同层。**否决**——折叠态可丢（丢了只是展开），但"我创建的文件夹"丢失=数据丢失感知；且 owner 场景是多设备/刷新后仍在，localStorage 不跨设备、清缓存即失。与 R14「文件夹=笔记库层面的组织」定位冲突。
  - **B. 建文件夹必须同时建第一篇文档**：**否决**——违背 owner 原话「直接增加一个创建目录的功能」，强塞一篇空笔记是设计债，且会污染 nodes 表与 vault 磁盘。
  - **C. 服务端小表（草案）**：`tree_folders(path PK, created_at)` 是**最小诚实实现**。只存"用户显式创建过这个空文件夹"这一个事实，派生文件夹继续由 `tree.folder` 推导，零迁移风险（纯新增表）。
- 迁移模式草案照抄既有 `PRAGMA table_info` 是对的，但**此处更简单**：新表用 `CREATE TABLE IF NOT EXISTS`（schema.sql 既有全部表都是此模式，schema.sql:1/11/40/…），**根本不需要 PRAGMA 列探测**（那是给"给旧表加列"用的，connection.ts:38-43）。新表无列迁移问题。**建议：草案措辞「connection.ts migrate() 加幂等迁移（照抄既有 PRAGMA table_info 模式）」改为「schema.sql 加 CREATE TABLE IF NOT EXISTS 即可，migrate() 无需改动」**——PRAGMA 模式是过度设计。

> 有没有更小的诚实实现？没有。表只有 2 列已是底线；派生并集是唯一能同时满足"空文件夹持久"和"不动既有派生逻辑"的路径。

---

## Q2 — POST /api/folders "已存在"判定：派生存在算 409 还是静默物化

**裁决：CHALLENGE 草案的模糊留白 → 明确定为「派生存在返回 200/既有语义，显式存在才 409」。**

推理：
- 草案把这题留给我裁决（"显式或派生均算存在？待你裁决"）。二选一要落到用户心智模型。
- 关键事实：显式表与派生是**并集渲染**（草案 item 1）。用户在 UI 上**看不出**一个文件夹是"显式创建的"还是"因为某个库在里面而派生的"——两者长得一模一样（都是 `.tree-dir-header`，TreeLauncher.tsx:485-527）。
- 因此"创建一个已由派生存在的文件夹"的用户意图是：**「我要这个文件夹稳定存在（即使我把里面的库都移走）」**。对这个意图，正确响应是"好的，已确保它存在"（幂等成功），而不是"409 冲突，它已经存在了"——后者对用户是**假错误**，因为从用户视角文件夹确实"还不存在于我的显式集合里"。
- 结论：
  - **派生存在（`trees.folder` 已产生该 path）但显式表无记录** → **物化到显式表并返回 201/200**（幂等 upsert，`INSERT OR IGNORE` / `INSERT ... ON CONFLICT DO NOTHING`）。语义="固化这个文件夹"。
  - **显式表已有该 path** → 幂等，返回 200（或 409 也可，但 200 更符合"确保存在"心智）。**这里我不坚持 409**：因为 path 是 PRIMARY KEY（草案 item 1），重复创建同名文件夹是无害幂等操作，报 409 只是给前端多一个要处理的错误分支。
- **反对草案的 409-on-derived**：会造成"我明明想固化这个文件夹，系统却说已存在不让我建"的死路——用户无法把一个派生文件夹变成"稳定文件夹"。

> 简言之：**创建=幂等确保存在（upsert），永不因"派生已存在"报错**。只在 sanitize 后为空时 400。

---

## Q3 — remove 用 POST body 而非 DELETE /api/folders/:path

**裁决：CONFIRM（POST body 正确）；但草案的技术理由（"自研路由 slash 匹配风险"）需事实校正。**

事实校正（重要）：
- 草案假设跑的是"自研精简路由"。**实测不成立**：`fastify@5.0.0` 已安装（`packages/server/node_modules/fastify/package.json` 存在，package.json 依赖声明 `"fastify": "^5.0.0"`）。`createAppInstance()` = `nativeFastify() ?? createFallbackApp()`（app-instance.ts:307-309），fastify 在场即用真 fastify，**自研 fallback 仅在 require('fastify') 抛错时启用**（app-instance.ts:87-97）。生产、`buildApp` 测试（trees.test.ts:12 `buildApp(deps)`）跑的都是真 fastify。
- 但 **POST body 的结论对两种路由都成立**，理由如下：

自研路由的 slash 行为（我对 `compilePath` 做了运行时实证，app-instance.ts:99-110）：
```
compilePath('/api/folders/:path') → /^\/api\/folders\/([^/]+)$/
"/api/folders/a"      → pathname "/api/folders/a"     → match ["a"]        ✓
"/api/folders/a/b"    → pathname "/api/folders/a/b"   → match NULL         ✗ 404
"/api/folders/a%2Fb"  → pathname "/api/folders/a%2Fb" → match ["a%2Fb"] → decode "a/b" ✓（但依赖调用方转义）
```
- 自研路由 `[^/]+`（app-instance.ts:106）**天然拒绝含 `/` 的路径参数**——多级路径 `a/b` 会 404。虽然 `%2F` 编码能绕过（因为 `new URL().pathname` 不解码 `%2F`），但这要求前端严格 `encodeURIComponent`，且**真 fastify 默认对 `%2F` 的处理更严格**（历史上 `find-my-way` 对编码斜杠有专门行为，且各版本不一）——依赖 `%2F` 是脆弱契约。
- **文件夹 path 本质是多级的**（`a/b/c`，草案 item 3），用路径参数天然踩坑。
- **先例支持 POST body**：`moveNode` 正是 `POST /api/nodes/:id/move` + body `{directory}`（node-edit.ts:29-37；client.ts:220-224；测试 node-move.test.ts:25 `payload: { directory: '工作/周报' }`）——含斜杠的多级目录走 POST body，是已验证的既有模式。

> CONFIRM `POST /api/folders/remove` body `{path}`。理由更正为：**path 是多级斜杠路径，用路径参数在真 fastify 与自研 fallback 下都不可靠；moveNode 已确立"斜杠路径走 POST body"先例**。GET/POST 创建同理——`GET /api/folders` 无参数没问题，创建/删除都走 body。

---

## Q4 — 删除语义"子目录不阻塞"是否正确

**裁决：CONFIRM（子目录不阻塞正确），但需补一条防面上的语义说明 + 一个 UI 一致性告警。**

推理：
- 场景：`a/b` 存在树（派生出结构节点 `a`、`b`），`a` 又被显式创建为空文件夹。删显式的 `a` 后，`a` 仍作为 `a/b` 的结构父节点出现。
- 这**可接受且正确**，因为：
  - 删除只删"显式记录"这一个事实（草案 item 4「只删显式记录，派生文件夹无需删」），不触碰任何 tree（`tree.folder` 一字未改）。**零数据风险**——这是本设计最安全的部分。
  - 删除的语义是"取消固化"，不是"删除文件夹及内容"。`a` 因 `a/b` 仍在而继续派生存在，符合"文件夹是组织视图，不是容器实体"的既有模型。
- **但删除的前置条件要精确**。草案 item 4：「仅当**无活跃 tree 的 folder 严格等于**该 path 时可删」。这里"严格等于"要审：
  - 假设显式创建 `a`，然后把库 X 拖进 `a`（`X.folder='a'`）。此时删 `a` 应 409（非空）——`X.folder === 'a'` 严格等于，正确阻塞。✓
  - 假设显式创建 `a`，库 Y 在 `a/b`（`Y.folder='a/b'`）。`Y.folder='a/b' !== 'a'`，**不阻塞**，可删显式 `a`。删后 `a` 因 `a/b` 派生继续存在。✓ 与草案一致，可接受。
  - **告警（UI 一致性）**：上一条会造成"我点了删除 `a`，但 `a` 还在列表里"（因为 `a/b` 派生）。用户困惑度中等。**建议**：删除按钮**只在该文件夹既是显式、又无任何派生占用（自身及子孙无 tree）时才显示/启用**——即 `folderTreeCount(folder) === 0`（TreeLauncher.tsx:66-68 已有此函数）且无子显式文件夹被别的 path 占用。这样"能点删除的文件夹删完就真消失"，无假象。草案 item 9「非空或有派生占用时不显示/禁用」方向对，**要显式用 `folderTreeCount(folder)===0` 作为判据**，把"派生占用"量化。

> CONFIRM 服务端"子目录不阻塞"；前端删除入口的可见性判据收紧为 `folderTreeCount===0`，避免"删了还在"的假象。删除语义零数据风险（不动 trees）。

---

## Q5 — 显式空文件夹并入 buildFolderTree 后，DnD / 折叠 / roving 是否被破坏

**裁决：CHALLENGE —— 发现 1 个 BLOCKER-级 guard 缺陷 + 1 个 DOM 重构耦合，草案"复用既有"低估了改动面。**

### 缺陷 5.1（BLOCKER）：`buildFolderTree` 的 null 短路

TreeLauncher.tsx:28-29：
```ts
function buildFolderTree(trees: TreeRow[]): FolderTree | null {
  if (!trees.some((tree) => tree.folder?.trim())) return null   // ← 致命
```
- 若**没有任何 tree 带 folder**（例如全新用户刚点"新建文件夹 a"，但还没有库进去），`buildFolderTree` 直接返回 `null`。渲染分支（TreeLauncher.tsx:552-559）落到 `: trees.map(renderTreeItem)`——**平铺列表，空文件夹 `a` 根本不在其中**。
- 后果：**用户创建的空文件夹永远不显示**，功能等于没做。
- 草案 item 1「buildFolderTree 加 folders 入参……显式路径经 ensureFolder 建节点」——**必须同时把第 29 行的 guard 改成 `if (!trees.some(f) && folders.length === 0) return null`**（或干脆改为"folders 非空或有 tree 带 folder 才建树"）。这不是"加个参数"，是改核心 guard。**coder 契约必须显式写明这一行。**

### 缺陷 5.2（隐藏耦合）：`.tree-dir-header` 是单 button，无法内嵌删除按钮

TreeLauncher.tsx:492-513，文件夹头是**一个 `<button>`**：
```tsx
<button
  className="tree-dir-header..."
  data-folder-path={folder.path}
  data-launch-row              // ← roving 锚点
  onClick={() => toggleFolder(...)}
  onDragOver={...} onDrop={...} // ← drop target
  ...
>
  <span class="tree-node-toggle">...</span>
  <Icon name="folder" .../>
  <span class="tree-dir-name">{label}</span>
  <span class="tree-dir-count">{count}</span>
</button>
```
- HTML **不允许 button 内嵌 button**（草案 item 9「文件夹头提供删除入口（垃圾桶图标）」）。要加删除按钮，必须把 `.tree-dir-header` 从"单 button"重构为"行容器（div）+ toggle-button + 删除-button"，就像 `.tree-item` 那样（TreeLauncher.tsx:401-483，li 里 open-button + action-buttons 并排）。
- 这个重构牵动三处：
  1. **DnD**：`onDragOver`/`onDrop`/`onDragLeave` 现在挂在 button 上（TreeLauncher.tsx:499-511），重构后要迁到新容器或保留在 toggle-button；`is-drop-target` className（TreeLauncher.tsx:495）也要跟着走。
  2. **roving**：`data-launch-row` 现在在 button 上（TreeLauncher.tsx:497），键盘导航靠它（handleListKeyDown 第 328 行 `querySelectorAll('[data-launch-row]')`）。重构后**必须保证每个文件夹头只有一个 `data-launch-row`**，否则新增的删除按钮若也成 launch-row 会打乱↑↓计数。删除按钮应是 `.tree-dir-header` 内的次级 action（类比 `.tree-item-action`，它们**不带** `data-launch-row`）。
  3. **CSS**：`.tree-dir-header { width: 100% }`（Workbench.css:332）、`.tree-dir-header`（Workbench.css:476-499）针对 button 写的（padding/hover/drop-target），重构成容器后要复核这些选择器是否还命中。
- **折叠持久化**（`vibe-docing:tree-folders`，TreeLauncher.tsx:70/176-184）：**不受影响**——折叠键是 `folder.path`，空文件夹有自己的 path，天然并入，无破坏。✓
- **DnD drop 到空文件夹**：`dropValid = dragTree !== null && dragTree.from !== (folder.path||null)`（TreeLauncher.tsx:489）——空文件夹 path 非空，拖库进来 `from !== path` 成立，drop 有效。✓ **前提是缺陷 5.1 已修**（空文件夹得先在 folderTree 里有节点）。

> CHALLENGE：草案 item 5/8/9「复用既有 DnD/roving」的说法掩盖了 (a) guard 必须改、(b) 文件夹头必须从 button 重构为容器两处实质改动。两者都要写进 coder 契约的验收清单，否则"复用"是空话。

---

## Q6 — 前端合并渲染的最小改动点 + 隐藏耦合

**裁决：CHALLENGE 草案对"最小改动"的估计。真实最小改动点比草案列的多。**

草案列的三点（folders state + buildFolderTree 签名 + renderFolder 删除入口）**不完整**。实测的完整改动面：

1. `folders` state + 加载 effect（照 `trees` 的 listTrees effect，TreeLauncher.tsx:139-147）。
2. `buildFolderTree` **签名 + 第 29 行 guard**（缺陷 5.1）——不只是加参数。
3. `buildFolderTree` 内部：显式 folders 经 `ensureFolder(path.split('/'))`（复用既有 ensureFolder，TreeLauncher.tsx:33-48，✓ 这个确实可复用）建空节点。
4. `renderFolder` **DOM 重构**（缺陷 5.2）：文件夹头 button→容器，加删除按钮。
5. **新建文件夹入口**（草案 item 7）：`.new-tree-row` 旁加"＋新建文件夹"触发 + 内联表单——新 DOM + 新 state（表单开合/输入值）。
6. **`trees.length > 0 &&` 的隐藏耦合（Hub Q6 自己的怀疑，实证成立）**：

TreeLauncher.tsx:550：
```tsx
{trees.length > 0 && (
  <ul aria-label="已有笔记库" onKeyDown={handleListKeyDown}>
```
- 全删光的库（`trees.length===0`）+ 只有空文件夹 → **整个 `<ul>` 不渲染**，空文件夹 + 其删除入口全部消失，用户困在"我建了文件夹但看不到"。
- **必须改为** `(trees.length > 0 || folders.length > 0) &&`（或 `folderTree` 非空判据）。**写进 coder 契约。**

7. **移动候选 `allFolders`**（TreeLauncher.tsx:172-174）：现在从 `trees.map(t=>t.folder)` 去重得出。空文件夹**不在** trees 里，所以"把库移入一个刚建的空文件夹"在移动 popover（renderMoveMenu，TreeLauncher.tsx:347-399）里**选不到那个空文件夹**。若要让移动菜单也能选空文件夹，`allFolders` 要并入显式 folders。**边界告警**：草案没提这点。主路径（拖拽进空文件夹）能覆盖，但移动菜单路径会缺项，属体验不一致。建议 `allFolders` 也取并集。

> CHALLENGE：真实改动点 = 7 处（含 2 处 Hub 未列的耦合：`trees.length>0` 守卫、`allFolders` 并集）。草案的"最小改动点"清单要补全，否则 coder 会漏改导致空文件夹在"空库"和"移动菜单"两个场景不可见。

---

## Q7 — 写权清单与 R8/R10 保护区、R20 P0 未提交改动的交集

**裁决：CONFIRM 保护区（pre/code 几何 1290-1308）零交集；但 CHALLENGE「零交集」的整体说法——Workbench.css 与 client.ts 存在文件级并写风险，需明确处置。**

证据：
- **R8/R10 保护区（pre/code 几何）**：Workbench.css:1285-1312（实测：`.doc-body pre { font-size:13px; line-height:1.55; padding:16px 20px; ... }`）。文件夹功能的 CSS 全在 `.tree-launcher` 区（Workbench.css:186-607），与 1285-1312 **物理相隔千行，零交集**。✓ 这部分草案对。
- **但 Workbench.css 是文件级共享写点**：
  - R20 P0 已对 Workbench.css 做了未提交改动（`git status` 确认 `M packages/web/src/components/Workbench.css`；`git diff --stat` 显示 +21 行，即 1310+ 的「R20 P0 代码块增强」新增块）。
  - 文件夹功能**也要写 Workbench.css**（新建文件夹表单样式、空文件夹删除按钮样式、文件夹头容器重构后的选择器调整——见缺陷 5.2）。
  - **两者都改同一文件**。虽然 R20 P0 已验收（不是当前活跃写者），但其改动**尚未提交**（未 commit）。若 coder 在含 R20 未提交改动的工作树上编辑 Workbench.css，只要 coder 只在 `.tree-launcher` 区（186-607）增改、不碰 1285-1312 保护区与 1310+ 的 R20 P0 块，**diff 可清晰共存**。**处置建议：coder 契约明确 (a) 只在 Workbench.css 的 .tree-launcher 区（约 186-607 行）增改；(b) 禁碰 1285-1312 与 R20 P0 新增块；(c) 交付时贴 Workbench.css 全 diff 供 Hub 逐行核 R20 改动未被扰动。**
- **client.ts**：R20 未改（不在 git status）。文件夹功能要加 `listFolders/createFolder/removeFolder`（草案 item 6）。**无并写冲突**。✓
- **package.json / pnpm-lock**：R20 改了 `packages/web/package.json`（shiki 依赖）。文件夹功能**不需要新依赖**（纯自研 SQL + fetch + React），**不应碰 package.json/pnpm-lock**。若 coder 试图加依赖 → blocker 信号。
- **DocView.tsx / markdown.ts / MarkdownEditor.tsx / highlight-code.ts**（R20 P0 未提交 8 文件）：文件夹功能**完全不碰**这些（渲染层 vs 笔记库入口层，无关）。✓ 真零交集。

> CONFIRM 保护区几何零交集；CHALLENGE「整体零交集」——Workbench.css 是文件级并写点（与 R20 未提交改动同文件），需在 coder 契约里用行区约束 + 全 diff 核验来隔离，而非假设零交集。

---

## Q8 — 测试面最低覆盖清单

**裁决：CONFIRM 草案的浏览器 e2e 场景足够作为验收；补充单测最低清单（草案未给具体清单）。**

参照既有测试模式（trees.test.ts:6-12 `setup()` → `buildApp(deps)` + `app.inject`；node-move.test.ts 的 payload 校验），最低覆盖清单：

**服务端路由测试（新建 `packages/server/src/routes/folders.test.ts`，仿 trees.test.ts）：**
1. `POST /api/folders` body `{path:'a'}` → 201，`GET /api/folders` 返回 `[{path:'a'}]`。
2. `POST /api/folders` 多级 `{path:'a/b'}` → 201；**中间段 `a` 不物化**（GET 只返回 `a/b`，或按草案 item 3 验证中间段行为）。
3. `POST /api/folders` sanitize 后为空（`{path:'   '}` / `{path:'../..'}`）→ 400。**必须覆盖路径穿越**：`{path:'../etc'}` 经 sanitizeTreeFolder 后应无 `..`（对照 node-move.test.ts:34 `'../etc'` 先例）。
4. `POST /api/folders` 幂等：同 path 二次 → 200/201 无重复（Q2 裁决：upsert 不报错）。
5. `POST /api/folders` 派生存在时（先建 tree 且 setFolder('a')，再 POST folders `{path:'a'}`）→ 物化成功非 409（Q2 裁决）。
6. `POST /api/folders/remove` body `{path:'a'}` 空文件夹 → 200，GET 不再含 a。
7. `POST /api/folders/remove` 非空（有 tree.folder==='a'）→ 409 FOLDER_NOT_EMPTY（Q4）。
8. `POST /api/folders/remove` 子目录不阻塞（tree.folder==='a/b'，删 'a'）→ 200（Q4）。
9. **sanitizer 复用回归**（R16 ㉑ 教训，见下）：trees.ts 与 folders.ts 共用同一 sanitize，加一个跨文件断言或至少确保不新增第二份实现。

**Web 组件测试（TreeLauncher.test.tsx 增用例）：**
10. 只有空文件夹（trees 全无 folder，或 trees 为空）时，空文件夹**仍渲染**（回归缺陷 5.1）。
11. `trees.length===0` + 有空文件夹 → 列表 `<ul>` 仍显示（回归缺陷 5.2 / Q6 第 6 点）。
12. 空文件夹 `folderTreeCount===0` 显示计数 0 + 显示删除入口；有派生占用时删除入口不显示（Q4）。
13. 新建文件夹表单：Enter/按钮创建、Esc 取消、多级 a/b 输入（草案 item 7）。
14. 键盘 roving：文件夹头（含空文件夹）参与 ↑↓，每头仅一个 `data-launch-row`（回归缺陷 5.2）。

**Hub 浏览器 e2e（草案已列，CONFIRM 足够）**：创建→空显示→刷新持久→拖库进入→计数→删除空/非空 409。**补一条**：全删库后只剩空文件夹时列表仍可见（覆盖缺陷 5.2 的真实回归，jsdom 单测 + 浏览器双保险）。

> CONFIRM e2e 场景；单测清单 14 条为最低面，其中 #10/#11/#14 是针对本审计发现的缺陷 5.1/5.2 的**回归锁**，必须有。

---

## 复用与防重复（草案 item 5）核验 —— R16 ㉑ 教训实锤

**CONFIRM 草案的"禁止复制第二份清洗器"是对的，且问题已实际存在。**

实测两份清洗器**近乎逐字节相同**：
- `packages/server/src/routes/trees.ts:5-14` `sanitizeTreeFolder`
- `packages/server/src/service/vault-service.ts:150-159` `sanitizeDirectory`

两者逻辑完全一致（`split(/[\\/]+/)` → trim → 过滤 `.`/`..` → `replace(/[^\p{L}\p{N}_\- ]/gu,'')` → `slice(0,6)` → `join('/')`）。trees.ts:4 注释自己都写了「与笔记目录（vault-service.sanitizeDirectory）同一纪律」——**这已经是 R16 ㉑「清洗器逐字节复制」元结论点名的重复**。

- 草案 item 5 要把 `sanitizeTreeFolder` 提升共享给 folders.ts 用——**方向对，但要更进一步**：应把 `sanitizeDirectory` 也一并收敛到同一份（三处共用），否则本轮只是把"2 份"变成"1 份共享 + 1 份 vault 私有 = 仍 2 份"，没根治。
- **放置位置建议**：提到 `packages/shared/src/`（纯函数，无 IO 依赖，shared 已有 sanitizeTagList/parseNodeTags 等清洗器先例，TASK.md #16）。server 三处（trees/folders/vault）import 同一份。
- **风险**：`sanitizeDirectory` 是 vault-service 的闭包内函数（vault-service.ts:150，在 `createVaultService` 内），提取要确认它不依赖闭包变量——实测它是纯函数（只用入参 input），可安全外提。

> CONFIRM item 5；**加码建议**：本轮顺手把 vault 的 `sanitizeDirectory` 也收敛进同一份共享清洗器（三处共用），真正落地 R16 ㉑ 的教训，而非留个尾巴。若 Hub 认为超范围，至少 folders.ts 必须 import trees 提升出来的那份，**严禁第三份**。

---

## 数据安全复核（停止条件自检）

- 新表 `tree_folders` 纯新增，`CREATE TABLE IF NOT EXISTS`，**不改任何既有表/列/数据**。零迁移风险。
- 删除文件夹只删 `tree_folders` 记录，**不触碰 trees/nodes/vault 磁盘**（对照 Q4）。零用户数据风险。
- 创建/删除不写 vault 磁盘（与笔记层 file_path 目录无关，草案范围外正确）。
- **未发现"会破坏 vibe-local.db 用户数据"的设计**——不触发 blocker 停止条件。
- **未发现"必须扩大范围才能诚实实现"**（TreePanel 笔记层无需连带；重命名明确排除）——范围边界正确，不触发 blocker。
- 仓库状态与 TASK.md 记录**基本一致**（R20 P0 未提交 8 文件在，fastify 在场）；唯一偏差是 Q3 前提"自研路由"与实际"真 fastify 在场"不符，已在 Q3 校正，**不构成"严重不符"**，不触发 blocker。

---

## 范围外边界确认（草案末节）

- **TreePanel（笔记层 file_path 目录）显式创建**：CONFIRM 排除。笔记层目录是 vault 磁盘 file_path 派生（vault-service.moveNodeFile），与库层 tree.folder 是两套机制（TASK.md #17「两层文件夹概念」），本轮只做库层，正确。
- **文件夹重命名**：CONFIRM 排除。库层重命名要批量改写多个 `tree.folder`（TreeLauncher 无此路径，tree-repo.setFolder 单条），显式表还要连带改 path，是独立一轮的量。
- **分享页/搜索面板感知文件夹**：CONFIRM 排除。search.ts:35-71 只查 nodes 全文，与文件夹无关；分享 renderer 亦然。空文件夹对这两个面无意义（没有内容）。

---

## 给 Hub 的放行建议（结论）

**方案可做，但放行 coder 前，契约必须补写以下 5 条硬约束**，否则会交付"空文件夹不显示"的半成品：

1. **[必须] buildFolderTree guard 修正**：TreeLauncher.tsx:29 的 `if (!trees.some(...))` 改为同时考虑 folders 入参（缺陷 5.1）。
2. **[必须] 列表渲染守卫修正**：TreeLauncher.tsx:550 `trees.length > 0 &&` 改为并入 folders（缺陷 5.2 / Q6-6）。
3. **[必须] 文件夹头 DOM 重构**：`.tree-dir-header` 从单 button 改为容器 + toggle + 删除按钮，保证仅一个 `data-launch-row`、DnD 处理器与 `is-drop-target` 正确迁移（缺陷 5.2）。
4. **[必须] 清洗器单一化**：folders.ts 复用 trees 提升出的共享 sanitize，严禁第三份；建议顺手收敛 vault 的 `sanitizeDirectory`（R16 ㉑）。
5. **[必须] Workbench.css 行区约束**：只在 .tree-launcher 区（约 186-607）增改，禁碰 1285-1312 保护区与 R20 P0 未提交块；交付贴全 diff（Q7）。

**语义裁决 2 条**（供 Hub 拍板）：
- Q2：创建=幂等 upsert，派生已存在**物化返回成功而非 409**。
- Q4：删除入口可见性判据 = `folderTreeCount(folder)===0`（避免"删了还在"假象）；服务端"子目录不阻塞"保留。

**事实校正 1 条**：Q3 的"自研路由"前提与实际（fastify@5 在场）不符，POST-body 结论不变但理由更正为"多级斜杠路径 + moveNode 先例"。

切换/回退触发器：若 coder 反馈"文件夹头重构导致 DnD/roving 测试大面积红"，回退方案 = 删除入口不放文件夹头内，改为**空文件夹头右键/hover 出的独立 action 行**（不动 button 结构），以换取更小 diff；此为 fallback，非首选。
