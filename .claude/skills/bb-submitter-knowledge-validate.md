# bb-submitter Knowledge Validate

知识验证模式 -- 检查站点知识是否仍然有效（DOM 选择器是否匹配最新页面）。

## 触发词

当用户提到"验证"、"validate"、"检查知识"、"检测站点"、"知识是否过期"、"刷新知识"等意图时触发。

CLI 入口: `bb-submitter knowledge validate <site>` (已在 CLI 中完整实现)

## 工作流程

### 1. 加载站点知识

```typescript
import { loadKnowledge, saveKnowledge } from 'src/knowledge-base.js'
import { validateKnowledgeStructure } from 'src/knowledge-base.js'

const knowledge = loadKnowledge(siteId)
// 1a. 结构验证:
const structResult = validateKnowledgeStructure(knowledge)
// 检查: site.name, site.url, auth.method, workflow.steps 完整性
```

### 2. 打开站点 URL

```typescript
import { bbOpen, bbSnapshot, bbClose } from 'src/bb-browser.js'

bbOpen(knowledge.site.url)
// open 失败 -> 标记 BROKEN
bbSnapshot({ interactive: false })
// snapshot 失败 -> 标记 BROKEN
```

### 3. 逐步骤验证 Ref/Semantic

对 knowledge.workflow.steps 中所有包含 `ref` 的步骤:

```typescript
import { matchRef, parseRef } from 'src/ref-utils.js'

for (const step of refSteps) {
  const match = matchRef(step.ref!, snapshot, step.semantic)
  if (match) {
    // [OK] ref=<ref> => @<matched-index> (direct/semantic)
    matched++
  } else {
    // [--] ref=<ref> => NOT FOUND
    failed++
  }
}
```

- `direct` 匹配: 索引 + tag + attr 都命中 -- 完全有效
- `semantic` 匹配: 索引变了但语义选择器仍命中 -- 页面有小变化但可容忍
- `NOT FOUND`: 选择器完全失效 -- 可能需要重新教学

### 4. 验证分类映射

对 `action: select_category` 的步骤:

```typescript
import { getMappedCategories } from 'src/category-mapper.js'

// 通过 snapshot 检查 select 选项中的值是否仍然存在
// 如果 mapped value 不在 option 列表中, 报告 WARNING
```

- 检查全局映射 `global_tags` 中的值是否仍在下拉选项中
- 如果不存在, 报告 WARNING 并建议更新映射

### 5. 报告结果

| 结果 | 条件 | 说明 |
|------|------|------|
| VALID | 所有 ref 都 direct 匹配 | 知识完全有效 |
| PARTIAL | 部分 semantic 匹配 或 分类映射有警告 | 页面有细微变化, 建议复习 |
| BROKEN | 所有 ref 都未匹配 或 打开页面失败 | 知识已失效, 需要重新教学 |

输出格式:
```
=== Knowledge Validation: <site> ===
 Structural validation: PASS
 Opening "<url>"... OK
 Ref steps: 6 total
   [OK]  Step 1: @12 → @12 (direct)
   [OK]  Step 2: @15 → @15 (direct)
   [OK]  Step 3: @22 → @25 (semantic)   ⚠ 索引变化
   [--]  Step 5: @7 → NOT FOUND          ✗ 元素丢失
 Matched: 5/6
 Result: PARTIAL
```

### 6. 更新时间戳

验证完成后更新 `knowledge.last_validated`:

```typescript
knowledge.last_validated = new Date().toISOString()
saveKnowledge(siteId, knowledge)
```

## Agent I/O Contract

| 方向 | 数据 | 格式 |
|------|------|------|
| Input | siteId | CLI 参数 |
| Output | 验证报告 | stdout |
| Output | last_validated | `knowledge/sites/<siteId>.yaml` |

## 注意

- 结构性验证优先于运行时验证 -- 结构不对直接标记 BROKEN
- 无 ref 的步骤 (如 open, wait) 不参与 DOM 匹配检查
- `select_category` 的映射验证是额外检查, 不影响 valid/broken 判定
- 验证完成后 Agent 应主动建议是否需要进行 re-teach
