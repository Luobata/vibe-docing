# Round 22 · TreeLauncher 显式创建文件夹

日期：2026-09-13。实现者：coder。依据：state/contracts/coder.md（含 Hub 对删除三条件的补充裁决）。

交付状态：实现和契约验证完成，交 Hub 验收。全量测试 **574 → 603**，新增 29 项，零删改既有断言；typecheck、build 通过。本轮未 commit、push、重启或停止服务。

## 实现及边界

- 新增 `tree_folders(path PRIMARY KEY, created_at)`，schema 与 migrate 只新增 CREATE TABLE IF NOT EXISTS 块。本轮迁移无既有表 ALTER/UPDATE/DELETE。
- `GET /api/folders` 返回显式记录；创建首次 201、重复 200 且保留 created_at；已有派生目录可物化。删除仅作用于精确显式记录；精确路径存在活跃笔记库则 409 / FOLDER_NOT_EMPTY，子目录与软删除笔记库不阻塞。检查与删除同一事务。
- sanitizeTreeFolder 从 trees 路由原样提升至 util/folder-path，trees/folders 共用。vault-service 未改。
- 新建笔记库行下方新增「＋ 新建文件夹」，内联输入支持多级路径，Enter 创建（IME 守卫）及 Esc/取消关闭；失败保留输入并展示原因。创建成功展开路径上的折叠父节点。
- 显式目录与 tree.folder 并集渲染；即使没有任何笔记库仍显示空目录。移动菜单并入显式目录；空目录可作为既有拖放确认流程的目标。
- 删除入口只对 **计数 0 ∧ 显式记录 ∧ 无子文件夹** 显示。删除叶子后，纯结构父节点自然消失；显式父节点保留并变得可删除。
- 文件夹头采用容器 + 两个兄弟按钮。原 toggle 保留 .tree-dir-header、DnD 处理器、data-launch-row、data-folder-path、aria-expanded；删除按钮没有 data-launch-row，不增加方向键行。未采用合同的独立 action 行降级方案。
- 已有 deps.trees 直接返回 repo 方法集合，因此无需更改 deps.ts/deps.test.ts。无新依赖，无 shared 类型变动。

## 改动清单与概览

本轮共 14 个实现/测试文件，另有本报告。除 Workbench.css 外，本轮文件在开工基线均无未提交改动。

| 路径（省略 packages/） | 本轮内容 |
| --- | --- |
| server/src/db/schema.sql | 新表，+5 |
| server/src/db/connection.ts | 幂等迁移块，+6 |
| server/src/db/connection.test.ts | 老库增表、重开持久化及幂等，+25 |
| server/src/util/folder-path.ts | 提升原清洗函数，11 行 |
| server/src/util/folder-path.test.ts | 6 项纯函数用例，15 行 |
| server/src/routes/trees.ts | 仅删除私有清洗函数并改 import，+1/-12 |
| server/src/routes/folders.ts | GET/POST/remove，29 行 |
| server/src/routes/folders.test.ts | 15 项路由测试，123 行 |
| server/src/repo/tree-repo.ts | 文件夹 CRUD，+26/-1 |
| server/src/app.ts | import + register，+2 |
| web/src/api/client.ts | FolderRow 与 3 方法，+16 |
| web/src/components/TreeLauncher.tsx | 状态、表单、并集、删除头与确认接线，+161/-33 |
| web/src/components/TreeLauncher.test.tsx | 新增 7 场景，+155 |
| web/src/components/Workbench.css | 本轮仅新增 18 行；对 HEAD 全 diff 另含 R20 的 21 行 |

## 当前运行验证

环境：Node **22.21.1**，pnpm 10.33.0。

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r build
```

三个命令均 exit 0。测试明细：

| 包 | 合同基线 | 本轮 |
| --- | ---: | ---: |
| shared | 34 | 34 |
| server | 207 | 229 |
| web | 333 | 340 |
| 总计 | 574 | **603** |

聚焦：server（folders、folder-path、connection、trees）35/35；TreeLauncher 23/23。全量原始日志：`/tmp/r22-folder-tests.log`、`/tmp/r22-folder-typecheck.log`、`/tmp/r22-folder-build.log`。

新增覆盖：路径穿越/6 段/非法字符清洗及两路由同义；201/重复200/派生物化/排序/删除/409/子目录不阻塞/不存在幂等/软删除占用；空目录创建与重挂载；删最后一个库后列表仍显示；删除三条件、取消零调用、结构父节点消失、无 button 嵌套、方向键；计数/去重；IME/Esc；空目录移动候选与拖放确认；创建400、删除409的失败提示。原有斜杠新建笔记库、DnD、折叠/方向键测试全保留且通过。

首轮 shell 默认 Node 25.8.1，与 better-sqlite3 已编译 ABI 不符，已改用本机项目要求的 Node 22 后复跑通过；没有重装依赖。首次类型检查指出直接导出 SQLite transaction 推导类型不可命名，已为新增两个方法标注普通函数签名，随后全量 typecheck 通过。此最后调整仅 TypeScript 类型标注，不改变已测运行时代码。

构建成功：web 主包 1,062.27 kB，gzip 376.23 kB。日志包含大 chunk 提示；全量测试中若干原有用例输出 React act 提示，未阻碍通过，未为此更改范围外测试。

## 迁移证据

**先验证再编辑 schema/connection**：SQLite 只读打开真实库，经 backup 得到 /tmp 副本；对该副本执行拟加入的 CREATE TABLE SQL 两次。对全部原有表按内容取 SHA-256，每次均与副本初始值一致，完整性检查为 ok。真实库未被脚本写入。

```text
copy: /tmp/r22-folder-migration-5e_aj6m0/copy.db
{"iteration": 1, "unchanged_existing_tables": 9, "counts": {"annotations": 35, "context_segments": 79, "document_shares": 2, "merges": 6, "node_versions": 89, "nodes": 53, "settings": 6, "trees": 23, "visual_artifacts": 0}, "tree_folders_columns": [[0, "path", "TEXT", 0, null, 1], [1, "created_at", "TEXT", 1, null, 0]], "integrity_check": "ok"}
{"iteration": 2, "unchanged_existing_tables": 9, "counts": {"annotations": 35, "context_segments": 79, "document_shares": 2, "merges": 6, "node_versions": 89, "nodes": 53, "settings": 6, "trees": 23, "visual_artifacts": 0}, "tree_folders_columns": [[0, "path", "TEXT", 0, null, 1], [1, "created_at", "TEXT", 1, null, 0]], "integrity_check": "ok"}
```

代码落地后，再对副本运行本轮实际 `openDb`（schema + migrate）入口两次，原有表内容仍一致、外键检查无违规：

```text
{"iteration":1,"entry":"current openDb(schema + migrate)","unchangedExistingTables":9,"integrity":[{"integrity_check":"ok"}],"foreignKeys":[],"folders":[]}
{"iteration":2,"entry":"current openDb(schema + migrate)","unchangedExistingTables":9,"integrity":[{"integrity_check":"ok"}],"foreignKeys":[],"folders":[]}
```

此外 connection 新增测试独立覆盖：现有数据库无 tree_folders → openDb 新建 → 插入空目录 → 重开后记录保留、原有 trees 行不变、integrity_check=ok。

## 浏览器证据（1440px、1980px）

通过 CUA/Chrome 实际打开 `http://127.0.0.1:5173/`，在两个规定视口（高度均 1000）查看新建入口与展开表单截图。两档均无横向溢出，输入框/创建/取消排列正常；控件几何如下：

```json
{"viewport":1440,"overflow":false,"controls":[{"name":"新建文件夹名称","x":12,"width":147,"height":34},{"name":"创建","x":163,"width":50,"height":34},{"name":"取消","x":217,"width":50,"height":34}]}
{"viewport":1980,"overflow":false,"controls":[{"name":"新建文件夹名称","x":12,"width":147,"height":34},{"name":"创建","x":163,"width":50,"height":34},{"name":"取消","x":217,"width":50,"height":34}]}
```

Esc 后 AX 树移除输入/创建/取消，焦点回到「新建文件夹」按钮。检查结束已还原 viewport override 并关闭临时页。运行中 GET /api/folders 实读返回 `{"folders":[]}`，服务已通过 watch 加载新路由。

**验证边界**：浏览器只验证入口、表单、取消及两档布局，没有在真实库写入测试文件夹或移动/删除 owner 笔记库。CRUD、刷新持久、删除、拖放计数由本轮路由/迁移测试与 UI 组件测试证明；真实浏览器完整 CRUD/DnD 链路留给 Hub 验收。

## R20 与范围检查

当前运行逐文件 SHA-256 比较：R20 的所有其他源码、测试、package.json、lock、editor/ 文件均与开工时一致。Workbench.css 去掉本轮新增块后 SHA-256 与开工基线严格相同；pre/code 保护区对 HEAD 逐字节相同：

```json
{
  "without_r22_sha256": "1a5a7ca7903c34f3a54663b9949845730d99968b11e764d4725911b6973c3de6",
  "protected_pre_code_equal_head": true,
  "withoutR22EqualsBaseline": true
}
```

本轮路径 `git diff --check -- <本轮 tracked 路径>` exit 0。全库 diff --check 另有 workspace/contracts/coder.md 原有 EOF 空行提示，该文件不在写权内，未修改。

只发生一次 blocker：指出多级空目录结构父节点删后仍在的问题；Hub 在 state 契约明确三条件后才完成该路径。无其他未解决 blocker。

## Workbench.css 完整 diff（包含原有 R20 21 行）

```diff
diff --git a/packages/web/src/components/Workbench.css b/packages/web/src/components/Workbench.css
index 545eb23..a5e8164 100644
--- a/packages/web/src/components/Workbench.css
+++ b/packages/web/src/components/Workbench.css
@@ -187,6 +187,24 @@ button { font: inherit; color: inherit; }
 .new-tree-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
 .tree-launcher input { min-width: 0; }
 
+.tree-launcher .new-folder-row { margin-top: 6px; }
+.tree-launcher .new-folder-trigger,
+.tree-launcher .new-folder-form button {
+  min-height: 32px; padding: 4px 10px;
+  border: 1px solid transparent; border-radius: var(--r2);
+  background: transparent; color: var(--primary); font-weight: 600; cursor: pointer;
+}
+.tree-launcher .new-folder-trigger { display: flex; align-items: center; gap: 6px; }
+.tree-launcher .new-folder-trigger:hover,
+.tree-launcher .new-folder-form button:hover:not(:disabled) { background: var(--primary-tint); }
+.tree-launcher .new-folder-form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px; margin-top: 6px; }
+.tree-launcher .new-folder-form button:last-child { color: var(--text-2); font-weight: 500; }
+.tree-launcher .new-folder-form button:disabled { color: var(--text-4); cursor: not-allowed; }
+.tree-launcher .tree-folder-header { display: flex; align-items: center; gap: 2px; }
+.tree-launcher .tree-folder-header .tree-dir-header { width: auto; }
+.tree-launcher .tree-folder-delete { opacity: .75; }
+.tree-launcher .tree-folder-delete:hover { color: var(--danger); background: var(--danger-tint); }
+
 /* 输入框（新建树 / 重命名） */
 .tree-launcher input,
 .chat-box textarea,
@@ -1307,6 +1325,27 @@ button { font: inherit; color: inherit; }
 }
 .doc-body pre code { padding: 0; border: 0; color: var(--text-1); background: transparent; font-family: inherit; font-size: 1em; line-height: inherit; }
 
+/* ============================================================
+   R20 P0 代码块增强（仅新增规则；上方 pre/code 几何为 R8/R10 验收产物，
+   一行未改）。shiki token 的着色 span 带 inline color，天然覆盖继承色，
+   无需触碰既有 color 声明。
+   ============================================================ */
+/* 复制按钮停靠位：position:relative 不产生任何视觉位移 */
+.doc-body pre { position: relative; }
+.doc-body pre > button.code-copy {
+  position: absolute; top: 8px; right: 8px;
+  padding: 2px 9px;
+  border: 1px solid var(--border-2); border-radius: var(--r1);
+  background: var(--surface); color: var(--text-3);
+  font: 11px/1.6 var(--sans);
+  opacity: 0; transition: opacity .12s ease;
+  cursor: pointer;
+}
+.doc-body pre:hover > button.code-copy,
+.doc-body pre > button.code-copy:focus-visible { opacity: 1; }
+.doc-body pre > button.code-copy:hover { color: var(--text-1); border-color: var(--border-3); }
+.doc-body pre > button.code-copy.is-copied { color: var(--primary); border-color: var(--primary); opacity: 1; }
+
 /* ============================================================
    可编辑正文 · 安静、编辑优先的文档画布
    ============================================================ */
```

## 取舍及剩余事项

前端只提供空叶子删除；服务端按合同允许删除无精确活跃库占用的显式记录，即使其子路径仍存在。因此直接 API 删除父显式记录后，其结构节点仍可能由子路径派生，这是约定语义。树移动、斜杠创建仍保留既有派生模式；只有显式创建过的路径保证最后一个库移走后仍存在。

本轮未处理笔记层目录、目录重命名、R21 空正文调查或 R20 渲染能力。未直接写真实数据库文件，未进行目录重命名/级联删除/历史数据修复。

