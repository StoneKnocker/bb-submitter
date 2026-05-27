# bb-submitter Batch

批量模式 -- 向所有已知站点提交产品，支持断点续传。

## 触发词

当用户提到"批量"、"batch"、"全量提交"、"提交到所有站点"、"继续提交"、"resume"等意图时触发。

## 入口函数

CLI 入口: `bb-submitter batch -p <productId> [--sites site1,site2] [--timeout 10]`

指定 `--sites` 可选地限制站点列表，`--timeout` 设置每站干预超时分钟数。

## 工作流程

### 1. 检测 Batch Lock

```typescript
import { loadBatchLock, createBatchLock, deleteBatchLock, updateBatchProgress, buildSiteQueue } from 'src/batcher.js'

const existingLock = loadBatchLock()
// submissions/.batch-running 存在 -> resume 模式
// 不存在 -> 全新 batch
```

- Resume 模式: 从 `lock.current_site` 位置继续 (跳过已成功的站点)
- 全新模式: 构建完整队列

### 2. 构建站点队列

```typescript
import { listSites } from 'src/knowledge-base.js'
import { loadTracker, getPendingSites } from 'src/tracker.js'

const allSites = opts.sites ? opts.sites.split(',') : listSites()
const tracker = loadTracker(productId)
const alreadySuccess = tracker.entries.filter(e => e.status === 'success').map(e => e.site)
const siteQueue = buildSiteQueue(allSites, alreadySuccess)
// 跳过 status = 'success' 和 'needs_review'
```

### 3. 逐站提交

```typescript
import { executeWorkflow } from 'src/executor.js'
import { makeTimedIntervention } from './cli.js'  // 或自行实现

for (const site of siteQueue) {
  const knowledge = loadKnowledge(site)
  const onIntervention = makeTimedIntervention(site, timeoutMinutes)

  const results = await executeWorkflow(
    knowledge.workflow.steps,
    product,
    onIntervention,
    productId,
  )

  // 记录结果 (同 submit 逻辑)
  updateTrackerAfterSubmission(tracker, site, results)
  saveTracker(tracker)

  // 更新进度
  updateBatchProgress(site)  // lock.current_site 推进到下一站

  // 5-10s 随机延迟 (速率限制)
  const delay = 5000 + Math.random() * 5000
  await sleep(delay)
}
```

### 4. 失败处理

- 网络错误: `executeStepWithRetry()` 自动重试 3 次
- HITL 干预: `makeTimedIntervention(site, timeoutMinutes)` -- 超时后默认 `done` 继续
- Daemon 崩溃: Agent 检测 `bbDaemonStatus()` 失败后自动调用 `bbDaemonStart()`，最多重试 3 次
- 连续 5 站失败: 停止 batch, 打印退出原因

```typescript
let consecutiveFailures = 0
const MAX_CONSECUTIVE_FAILURES = 5
// 每站失败时 ++, 成功后重置为 0
// >= 5 时 break
```

### 5. 清理与总结

```typescript
deleteBatchLock()
printBatchSummary(tracker, siteQueue)
// 输出:
// === Batch Summary ===
//   Success:     3
//   Failed:      1
//   Pending:     0
//   Not started: 1
// Details:
//   producthunt               success       https://ph.com/post/123
//   betalist                  failed        timeout
//   ...
```

### 6. Resume 恢复流程

```
1. Agent 启动 -> 检测 submissions/.batch-running 是否存在
2. 存在: 读取 lock, 获取 current_site
3. 在 site_queue 中找到 current_site 的位置
4. 从此位置开始继续, 跳过已成功的站点
5. 通知用户: "检测到未完成的 batch, 从 {current_site} 继续"
```

## Agent I/O Contract

| 方向 | 数据 | 格式 |
|------|------|------|
| Input | productId | CLI 参数 |
| Input | sites (可选) | `--sites` 逗号分隔 |
| Input | timeout (可选) | `--timeout` 分钟数 |
| State (lock) | BatchLock | `submissions/.batch-running` (YAML) |
| Output | SubmissionTracker | `submissions/<productId>.yaml` |
| Output | 控制台日志 | stdout |

## 注意

- 先确保 `bb-browser daemon` 已启动
- 不要修改 `batchCmd` 之外的代码 -- 通过 CLI 调用即可
- 如果用户中途 Ctrl+C, 下次启动会自动 resume
