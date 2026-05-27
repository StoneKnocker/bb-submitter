# bb-submitter Submit

回放模式 -- 使用已学习的站点知识提交产品。

## 触发词

当用户提到"提交"、"submit"、"回放"、"replay"、"提交到站点"等意图时触发。

## 入口函数

CLI 入口: `bb-submitter submit <site> -p <productId>`
底层 API: `executeWorkflow(steps, product, onIntervention, productId)`

## 工作流程

### 1. 加载数据

```typescript
import { loadProduct } from 'src/product-store.js'
import { loadKnowledge } from 'src/knowledge-base.js'
import { loadTracker } from 'src/tracker.js'

const product = loadProduct(productId)       // ProductData
const knowledge = loadKnowledge(siteId)       // SiteKnowledge { site, auth, workflow, known_quirks }
const tracker = loadTracker(productId)        // SubmissionTracker
```

### 2. 执行工作流

```typescript
import { executeWorkflow, executeStepWithRetry, StepResult } from 'src/executor.js'
import { matchRef } from 'src/ref-utils.js'

const results = await executeWorkflow(
  knowledge.workflow.steps,
  product,
  onIntervention,    // HITL 回调 (见下方)
  productId,
)
```

### 3. 每步解析逻辑

每步的执行过程:

```
  1. bbSnapshot (非交互模式) -- 获取当前 DOM 快照
  2. matchRef(recordedRef, snapshot, semantic) -- 尝试匹配:
     a. 直接索引匹配 (index + tag + attr)
     b. 语义选择器 fallback (CSS-like selector)
  3. 匹配成功 -> 执行 action (click/fill/select/upload/...)
  4. 匹配失败 -> 触发 intervention: "DOM change: element not found"
```

### 4. 错误处理

| 错误类型 | 检测方式 | 处理策略 |
|----------|----------|----------|
| network (timeout/ECONNREFUSED) | `classifyError()` | 自动重试 3 次 (5s / 10s / 30s) |
| captcha | `classifyError()` detects captcha | `handleIntervention()` 暂停等人工 |
| oauth / login | `classifyError()` detects oauth | `handleIntervention()` 暂停等人工 |
| DOM change (元素未找到) | `matchRef()` 返回 null | `handleIntervention()` + 提供 re-teach 选项 |
| form_validation | `classifyError()` detects validation | Agent 分析错误，修改值后重试 1 次 |
| server_reject (403/429/500) | `classifyError()` detects status code | 记录失败, 跳过 |
| file_upload_reject | `classifyError()` detects file error | 记录失败, 跳过 |

### 5. 人工介入 (HITL)

```typescript
import { handleIntervention, formatIntervention, InterventionRequest } from 'src/hitl.js'
import { isInteractiveError } from 'src/hitl.js'

// 创建干预回调:
const onIntervention = (reason: string, step: WorkflowStep) => {
  const req: InterventionRequest = { site, reason, step }
  return handleIntervention(req, getUserInput)
}
// 用户输入: 'done' / 'skip' / 'retry'
// Agent 根据用户选择继续 / 跳过 / 重试
```

Captcha / OAuth: 打印提示信息, 等待用户完成浏览器操作后输入 `done`。
DOM 变化: 向用户展示新旧 DOM 差异, 提供重新教学 (re-teach) 或手动修改选择器的选项。

### 6. 记录结果

```typescript
import { updateEntry, saveTracker, getSummary } from 'src/tracker.js'

// 成功:
updateEntry(tracker, siteId, 'success', { confirmation_url, submitted_at })
// 失败:
updateEntry(tracker, siteId, 'failed', { error })
// 需人工审核:
updateEntry(tracker, siteId, 'needs_review', { error, reason: interventionReason })
// 需后续重试:
updateEntry(tracker, siteId, 'pending', { error })

saveTracker(tracker)  // 写入 submissions/<productId>.yaml
```

### 7. Form Rejection 重试

当服务端返回 form_validation 错误时:
1. Agent 分析 `StepResult.error` 内容
2. 判断哪个字段 / 哪个步骤有问题
3. 修改值后调用 `executeStep(step, context)` 重试 (最多 1 次)
4. 再次失败则标记 `failed`

## Agent I/O Contract

| 方向 | 数据 | 格式 |
|------|------|------|
| Input | siteId | CLI 参数 |
| Input | productId | CLI 参数 |
| Input | HITL 决策 | 用户 stdin 输入 |
| Output | SubmissionEntry | `submissions/<productId>.yaml` |
| Output | 控制台日志 | stdout |

## 注意

- 始终在运行前检查 `bb-browser daemon` 是否存活: `bbDaemonStatus()`
- 如果 daemon 未启动, Agent 应自动调用 `bbDaemonStart()`
- 提交完成后记得 `process.stdin.pause()`
