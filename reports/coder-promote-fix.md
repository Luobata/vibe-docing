# R28 Phase 1 · promote 错误映射补丁

2026-09-13。状态：实现与当前运行验证完成，待 Hub 复核。

promote 蒸馏阶段的 provider 错误和内部 45 秒看门狗超时现在抛出 DiscussionError(502, 原错误消息)，通过现有路由返回可读 error。修复前普通 Error 没有被 sendError 识别，会进入默认 500。

## 改动与边界

- 生产改动仅 discussion-service.ts 的 promote 内 streamText 调用点：将一行 await 包入 try/catch。普通 Error 消息透传，非 Error 使用 promotion failed；调用者 signal 已取消时原样抛出，沿同文件 discuss 的取消语义。
- 不改变超时阈值、SSE 活性、路由、正文保存/版本/vault、400/409 前置检查或沉淀空内容检查。
- discussion-service.test.ts 只新增 import 与三个测试，既有九个测试字节未改：provider 产出部分内容后 reject → 502 原文；看门狗 44,999ms 未取消、45,000ms 取消 → 502 中文超时原文且计时器归零；主动取消保持原 reason。
- provider 失败和看门狗失败分别覆盖 child/section：子节点、正文/revision、版本、消息沉淀标记和临时 vault 均没有被失败输出改变。

## 当前运行证据

运行环境 Node 22.21.1；全量测试使用项目既有内存 DB/隔离临时 vault。没有访问真实树或修改真实数据库。

```sh
# packages/server 下
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm exec vitest run src/service/discussion-service.test.ts
# 仓库根目录
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
git diff --check
```

本次命令输出摘要：

```text
聚焦：Test Files 1 passed (1)；Tests 12 passed (12)；exit 0
shared：Test Files 8 passed (8)；Tests 43 passed (43)
server：Test Files 59 passed (59)；Tests 360 passed (360)
web：Test Files 50 passed (50)；Tests 388 passed (388)
全量：791/791；788 → 791（+3）；EXIT_CODE 0
三包 typecheck：Done；exit 0
git diff --check：exit 0
```

另以 Node 22 的 `pnpm exec tsx --input-type=module` 执行隔离 HTTP 探针：openMemoryDb + 临时 vault 创建一节点一讨论消息，provider.stream 抛出 Error("provider connection reset")，buildApp(deps).inject POST /api/nodes/:id/discussion/promote（child）。当前运行断言与输出：

```json
{"statusCode":502,"body":{"error":"provider connection reset"},"children":0,"messageUnchanged":true}
```

探针结束关闭临时 app/DB 并删除临时 vault，未监听端口，未重启或终止 :4000/:5173。

## 范围与剩余事项

packages/src 起点/终点 SHA256 对比只有 discussion-service.ts 和 discussion-service.test.ts 变化，零删除。机械对照确认：还原单个 try/catch 块后生产文件逐字等于开工版本；移除新增 import 和三个测试后测试文件逐字等于开工版本。其余契约一/二产物、web、shared 和依赖文件未改。另写本报告及共享 reports 同文副本。

本补丁只修复错误可见性。非 SSE promote 仍保留原 45 秒正文空闲超时，慢思考模型仍可能超时，但客户端可看到原因。尚未声明真实模型恢复成功；Hub 按合同复核。未提交、推送或部署。
