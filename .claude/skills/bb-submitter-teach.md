# bb-submitter Teach

教学模式 -- 学习一个新导航站的提交表单，生成 SiteKnowledge。

## 触发词

当用户提到"教学"、"录制"、"teach"、"学习站点"、"添加站点"等意图时触发。

## 工作流程

### 1. 加载产品数据

```typescript
import { loadProduct } from 'src/product-store.js'
const product = loadProduct(productId)
// product: { name, tagline, description, url, category_tags, contact_email, ... }
```

### 2. 打开目标站点

```typescript
import { bbOpen, bbSnapshot, bbClose } from 'src/bb-browser.js'
bbOpen(submitUrl)
bbSnapshot({ interactive: true })  // 检测是否弹出登录/验证
// 如果检测到 auth: 暂停等用户手动登录（见第 6 步）
```

### 3. 分析表单

对每个 `input` / `textarea` / `select` / `file input`:

- 从 label、placeholder、name、aria-label 中提取语义
- 调用 `extractElementMeta(ref)` 获取元素元信息 (type, placeholder, ariaLabel, name, id)
- 匹配到 `product.yaml` 的字段 (name, tagline, description, url, category_tags, etc.)
- 向用户展示映射建议

### 4. 用户确认映射

- 用户确认或调整字段映射关系
- 调用 `saveDraft(siteId, partialKnowledge)` 保存草稿 (写入 `knowledge/sites/.drafts/<siteId>.yaml`)

### 5. 执行录制步骤

对每个表单字段，通过 bb-browser 命令操作:

```typescript
bbClick(ref)
bbFill(ref, value)
bbSelect(ref, option)
bbUpload(ref, filePath)
bbCheck(ref)
bbPress(key)
```

- 每步操作后更新草稿中对应的 `WorkflowStep`
- 记录用户确认的字段映射到 `step.field`

### 6. 处理认证 (Auth)

- `open` 后通过 snapshot 检测到 `google_oauth` / `github` / 验证码等：
  - 设置 `step.human_intervention = '请手动登录...'`
  - 通过 `formatIntervention()` / `handleIntervention()` 暂停等待用户完成
  - 完成后 `bbSnapshot` 确认已登录
- 在 `SiteKnowledge.auth.method` 中记录认证方式

### 7. 生成语义选择器

对每个录制步骤，获取元素元信息并生成 fallback 选择器:

```typescript
import { extractElementMeta, generateSemanticSelector } from 'src/ref-utils.js'
const meta = extractElementMeta(ref)
const semanticSelector = generateSemanticSelector(meta)
// e.g. "[input][placeholder*='Product Name' i]"
```

- 将 `semanticSelector` 写入 `step.semantic`
- 保留原始 `bb-browser` 的 ref (如 `@12`) 到 `step.ref`

### 8. 生成站点知识 YAML

将录制的完整流程组装为 `SiteKnowledge`:

```yaml
site:
  name: ProductHunt
  url: https://producthunt.com/submit
auth:
  method: google_oauth
workflow:
  steps:
    - action: open
      target: https://producthunt.com/submit
    - action: fill
      field: name
      source: product.name
      ref: '@12'
      semantic: "[input][placeholder*='Product Name' i]"
    - action: fill
      field: tagline
      source: product.tagline
      ref: '@15'
      semantic: "[textarea][placeholder*='Tagline' i]"
    - action: select_category
      field: category_tags
      mapping: { "ai": "Artificial Intelligence", "developer-tools": "Dev Tools" }
      ref: '@22'
    - action: upload
      field: logo
      source: product.logo-256x256.png
      ref: '@7'
    - action: click
      ref: '@30'
      wait: 3000
      semantic: "[button][aria-label*='Submit' i]"
    - action: wait
      wait_for: '.success-message'
    - action: record_result
known_quirks:
  - "标签选择器需要先点击下拉箭头"
```

### 9. 用户确认 -> promoteDraft

```typescript
import { promoteDraft, saveDraft } from 'src/knowledge-base.js'
import { setMapping, saveMappings } from 'src/category-mapper.js'
// 用户确认后:
promoteDraft(siteId)           // 将 draft 移到正式文件, 删除草稿
setMapping(tag, siteId, siteCategory)  // 保存分类映射
saveMappings()
```

### 10. 取消 -> 保存草稿

如果用户取消，调用 `saveDraft()` 保留现场，告知用户草稿位置。

## Agent I/O Contract

| 方向 | 数据 | 格式 |
|------|------|------|
| Input | productId | 命令行参数 |
| Input | submitUrl | 用户交互提供 |
| Input | 字段映射确认 | 用户交互确认 |
| Output | SiteKnowledge | `knowledge/sites/<siteId>.yaml` |
| Output | Draft (进行中) | `knowledge/sites/.drafts/<siteId>.yaml` |
| Output | CategoryMappings | `knowledge/category-mappings.yaml` |
