# Contract · plan-backup（计划归档 + 风险清单）

- Hub 分派时间：2026-08-22
- 状态：**active**
- 回复路由：`node "/Users/bytedance/Documents/gpt/gsb-local/bin/relay.mjs" send hub progress|blocker|result '<payload-json>'`，发送后 `bash "/Users/bytedance/Documents/gpt/gsb-local/bin/nudge" hub`

## 1. Objective

为"会话地图 + UI 精修"任务（contracts/ui.md）建立独立的计划归档与风险清单，供中断恢复与审计。基线回滚 patch 已由 Hub 存于 `reports/baseline-2026-08-22-task-start.patch`（勿重复生成）。

## 2. Scope

**读**：contracts/ui.md、TASK.md、packages/web/src/（结构了解）。
**写（唯一写入者）**：
- `/Users/bytedance/.local/state/gsb-local/vibe-docing/reports/plan-backup-session-map.md`（唯一产出文件）
**禁触**：仓库内任何文件（/Users/bytedance/luobata/vibe-docing 下全部只读）。

## 3. Validation（done-when）

reports/plan-backup-session-map.md 存在且包含四节：
1. 目标摘要（会话地图 + UI 精修，一句话各）
2. 实施步骤快照（从 contracts/ui.md 提炼，编号列表）
3. 风险清单（至少：未提交用户改动被覆盖的风险与防护=基线 patch、测试基线状态=2026-08-22 pnpm check 全绿、ui 无写权限外路径、rollback 步骤=`git apply -R reports/baseline-*.patch` 需 Hub 执行）
4. 恢复指引（中断后从 contracts/ui.md + 本文件继续）
完成后发 result（附文件路径）。

## 4. Stop conditions

- contracts/ui.md 或基线 patch 缺失/不可读 → blocker。

## 5. Reply route

- 完成：`relay.mjs send hub result '{"summary":"plan archived","file":".../plan-backup-session-map.md"}'` + nudge hub。result 只发一次；无需 progress。
