# bb-submitter Design Spec

## Overview

自动化提交 web 产品到 100+ 导航站的平台。核心思路：第一个产品提交时，Agent 学习表单结构并记录为结构化知识；后续产品提交时，直接读取知识库自动重放。

**核心指标**: 100+ 导航站, 10+ web 产品, 非一次性工具。

## System Architecture

```
CLI (bb-submitter)
  ├── Teaching Mode (学习)
  ├── Replay Mode (重放)
  └── Batch Mode (批量 + Resume)
         │
         ▼
    Agent (Claude) ←→ Deterministic Executor
         │                    │
         ▼                    ▼
    bb-browser (Chrome)   File I/O (YAML/RW)
         │
    ┌────┴────┬──────────────┐
    ▼         ▼              ▼
Product    Site          Submission
Data       Knowledge     Tracker
Store      Base
```

### Agent vs Deterministic Code Boundary

| Layer | Responsibility | Implementation |
|-------|---------------|----------------|
| **Agent (LLM)** | 表单语义理解、字段映射推断、异常判断、用户交互对话 | Claude Code Agent |
| **Deterministic Executor** | YAML 读写、执行 workflow steps、ref 解析与匹配、文件上传路径拼接、状态追踪 | TypeScript code |

具体分工:

- **Agent 负责**: Teaching Mode 中分析 snapshot 推断字段语义并生成映射建议；Replay Mode 中 verify 失败时判断是 DOM 变化还是业务错误并决定降级策略；与用户对话交互
- **Deterministic Code 负责**: 加载 site knowledge YAML、按 step 序列调用 bb-browser 命令、ref 的语义匹配(见 Ref Stability)、文件路径拼接、Submission Tracker 写入、断点续跑状态管理

Agent 通过标准化的输入输出与 deterministic executor 通信:

```
Agent Input:  snapshot text + product.yaml + current step context
Agent Output: 映射确认 / 异常分类 / 降级决策 (结构化 JSON)
```

## bb-browser Interface Contract

本系统依赖 bb-browser CLI 的以下命令。每个命令定义了输入参数和期望的输出格式。

### Navigation

| Command | Input | Output | Notes |
|---------|-------|--------|-------|
| `open <url>` | URL string | tabId, current URL | 新 tab 打开 |
| `open <url> --tab current` | URL string | tabId, current URL | 当前 tab 打开 |
| `close` | - | - | 关闭当前 tab |

### Snapshot

| Command | Input | Output | Notes |
|---------|-------|--------|-------|
| `snapshot -i` | - | a11y tree with refs | 返回可交互元素列表 |

Snapshot 输出格式:
```
@1 [button] "Submit Your Startup"
@2 [input type="text"] placeholder="Startup name"
@3 [textarea] placeholder="Describe your product"
@4 [select] "Category"
@5 [input type="file"] accept="image/*"
```

每个 ref 包含: `@<index> [<element-type>] <label/placeholder/aria-label>`

### Element Interaction

| Command | Input | Output | Notes |
|---------|-------|--------|-------|
| `click <ref>` | ref string | - | 点击元素 |
| `fill <ref> <text>` | ref, text | - | 清空并填写 |
| `upload <ref> <filepath>` | ref, file path | - | 单文件上传 |
| `upload <ref> <file1> <file2>` | ref, paths | - | 多文件上传 |
| `select <ref> <option>` | ref, option text | - | select 下拉选择 |
| `check <ref>` | ref | - | 勾选 |
| `uncheck <ref>` | ref | - | 取消勾选 |
| `press <key>` | key string | - | 发送按键 |

### Information Retrieval

| Command | Input | Output | Notes |
|---------|-------|--------|-------|
| `get url` | - | current URL | 获取当前页面 URL |
| `get title` | - | page title | 获取页面标题 |
| `get text <ref>` | ref | element text | 获取元素文本 |
| `eval <js>` | JS expression | JSON result | 执行 JS 获取数据 |
| `screenshot <path>` | file path | - | 截图保存 |

### Utility

| Command | Input | Output | Notes |
|---------|-------|--------|-------|
| `wait <ms>` | milliseconds | - | 等待指定时间 |
| `wait <ref>` | ref | - | 等待元素出现 |
| `back` / `forward` / `refresh` | - | - | 页面导航 |
| `dialog accept` / `dialog dismiss` | - | - | 处理 JS 对话框 |

### Assumptions

- bb-browser 运行在用户真实 Chrome 浏览器中，复用已登录 Cookie
- bb-browser daemon 由本系统自动管理: CLI 启动时检测 daemon 状态, 未运行则自动 `bb-browser daemon start`; daemon 崩溃时自动重启(最多 3 次)
- 所有命令支持 `--json` 标志输出机器可读格式

## Ref Stability & Staleness Detection

### Strategy: Dual-Match with Semantic Fallback

每个 workflow step 的 `ref` 不是纯序号引用，而是包含语义信息的结构化引用:

```yaml
- action: fill
  field: "name"
  ref: "@2 [input] placeholder='Startup name'"
  semantic: "[input][placeholder*='name' i], [input][aria-label*='name' i]"
  source: "product.name"
```

执行时采用的匹配策略 (按优先级):

1. **Snapshot ref 优先**: 如果当前页面的 ref 序号对应的元素类型和属性与记录一致，直接使用(最快)
2. **Semantic selector 降级**: 如果 ref 不匹配(DOM 变化导致序号漂移)，使用 `semantic` CSS 选择器重新定位元素
3. **Agent 介入**: 如果两种方式都找不到匹配元素，暂停并交给 Agent 判断(页面结构发生了较大变化)

### Staleness Detection

`knowledge validate` 命令的实现:

```
bb-submitter knowledge validate <site>

1. bb-browser open <site.submit_url>
2. bb-browser snapshot -i
3. 对每个 workflow step:
   - 用 semantic selector 查找对应元素
   - 检查元素属性是否与记录一致
   - 对 select_category step: 检查 mapping 中的选项值是否仍在 select 的 option 列表中,
     存在不在 mapping 中的新选项则标记为 partial(站点分类可能已更新)
4. 报告结果:
   - ✅ valid: 所有 step 的元素都能找到且兼容
   - ⚠️ partial: 部分元素不匹配(报告具体哪些 step)
   - ❌ broken: 页面结构完全不同
5. 更新 last_validated 时间戳
```

### Ref Recording in Teaching Mode

Teaching 时 Agent 不仅记录当前 ref 序号，同时记录 semantic selector:

1. 获取 snapshot -i 拿到 ref(@N)
2. 用 `eval` 获取该元素的关键属性: tagName, type, placeholder, aria-label, name, id, class
3. 生成 semantic selector (取最稳定的属性组合)
4. 同时保存 ref 和 semantic selector

## Error Handling & Recovery

### Error Categories

| Category | Detection | Recovery | User Involvement |
|----------|-----------|----------|------------------|
| **DOM 变化** | ref 匹配失败, semantic 匹配失败 | Agent 重新分析当前页面, 更新 knowledge 或暂停 | Agent 尝试自动修复, 失败则暂停 |
| **网络问题** | bb-browser 超时/错误 | 重试 3 次(间隔 5s/10s/30s)；仍失败则记录并跳过 | 不打扰, 日志记录 |
| **表单验证错误** | 提交后页面显示错误信息 | Agent 分析错误信息, 尝试修正后重试 1 次 | Agent 自动处理, 失败后暂停 |
| **服务端拒绝** | 403/429/5xx | 429 等待 Retry-After；其他记录失败原因 | 不打扰, 记录 |
| **验证码** | snapshot 中检测到 captcha 元素 | 暂停, 人工完成 | 必须人工 |
| **OAuth** | 检测到 OAuth 弹窗/跳转 | 暂停, 人工完成登录 | 必须人工 |
| **文件上传拒绝** | upload 后页面显示格式/大小错误 | Agent 分析限制(如 "max 2MB"), 建议用户调整 | 暂停, 用户调整后继续 |

### Replay Mode Error Flow

```
Step N 执行失败
  ├── 非交互式错误 (网络/429)
  │     ├── 自动重试 (最多 3 次)
  │     ├── 成功 → 继续 Step N+1
  │     └── 仍失败 → 记录 failure, 跳到下一站点
  │
  └── 交互式错误 (验证码/OAuth/表单拒绝/页面变化)
        └── 暂停 → 通知用户 → 等待用户指令 (done/skip/retry)
```

### Teaching Mode Error Flow

```
Teaching 过程中
  ├── 页面加载失败 (bb-browser open 超时)
  │     └── 重试 2 次(间隔递增) → 仍失败则告知用户, 询问 skip/retry/abort
  │
  ├── Snapshot 异常 (页面为空/只有 loading)
  │     └── 等待 3s 后重新 snapshot → 仍异常则通知用户 "页面可能需要 JS 渲染或有反爬"
  │
  ├── 表单提交失败 (服务端返回错误)
  │     └── Agent 分析错误信息, 判断是否可修正(如字段格式问题)
  │         可修正 → 修正后重试 1 次
  │         不可修正 → 保存当前草稿, 告知用户原因, 询问如何处理
  │
  └── 用户主动取消 (Ctrl+C / "cancel")
        └── 保存草稿, 询问 "已保存草稿到 .drafts/<site>.yaml, 要继续时用 teach <site> --product <name> 恢复"
```

### Batch Mode Error Flow

```
Batch 过程中
  ├── bb-browser daemon 崩溃
  │     └── 自动重启 daemon → 恢复当前站点 → 失败则记录并 skip, 继续下一站
  │
  ├── 锁文件损坏 (.batch-running JSON 不完整)
  │     └── 读取时做结构校验, 损坏则视为"不存在"→ 重新扫描 Submission Tracker 重建 site_queue
  │
  ├── 单站失败
  │     └── 记录 failure, 立即写 Tracker + 更新锁文件, 继续下一站
  │
  └── 连续 5 站失败
        └── 判定为系统性故障(网络断连/Chrome 崩溃), 停止 batch, 通知用户检查环境
```

## Account Preparation Strategy

不同导航站对账号的要求不同。Teaching 阶段需要先确定站点的认证方式:

1. **Agent 首次分析**: Teaching 时, Agent 打开 submit 页面后, 先判断页面是否需要登录才能看到提交表单
   - 无需登录: `auth.method: none` — 直接进入表单分析
   - 需要登录: Agent 识别登录方式(Google OAuth / GitHub / Email) 并告知用户

2. **账号准备**: 需要登录的站, Teaching 的第一步是 auth 流程
   - OAuth 站: 暂停, 用户在浏览器中完成 OAuth 登录(复用已登录 Google 账号)
   - Email 注册站: Agent 可以填写 product.contact_email, 暂停让用户完成邮箱验证
   - 密码管理的站: 用户自己管理密码, Agent 暂停等待用户手动登录

3. **登录态持久化**: bb-browser 复用 Chrome 的 Cookie 存储, 只要用户在该浏览器中登录过一次, 后续 Replay 不需要重新登录(除非 Cookie 过期)

4. **Knowledge 中记录**: `auth.method` 和登录步骤的 workflow 在 Teaching 时记录下来。Replay 时如果检测到仍然登录着, 跳过 auth 步骤

## Batch Mode Resume

### State Persistence

Batch mode 运行时, 每完成一个站点的提交, 立即写入 Submission Tracker。Batch 运行时维护一个锁文件:

```
submissions/.batch-running
  product: myapp2
  site_queue: [site3, site4, ..., site100]
  current_site: site3
  started_at: 2026-05-27T10:00:00Z
```

### Resume Flow

```
bb-submitter batch --product myapp2

1. 检查 submissions/.batch-running 是否存在
   - 不存在: 新建, 初始化 site_queue (过滤已成功的站)
   - 存在: 从 site_queue 的 current_site 继续(断点续跑)

2. 遍历 site_queue:
   每个站点完成后立即写入 Submission Tracker + 更新锁文件 current_site

3. 全部完成后删除 submissions/.batch-running
```

### 暂停超时

Batch Mode 中 human_intervention 暂停后:
- 默认无限等待(用户可能离开很久)
- 可通过 `--timeout <minutes>` 设置超时, 超时后自动 skip 当前站, 继续下一个
- 超时跳过的站标记为 `status: pending`, 可后续单独 `submit`

## Teaching Mode Draft Persistence

Teaching 过程中支持随时中断和恢复:

```
knowledge/sites/.drafts/<site-id>.yaml
```

保存时机:
- 步骤 4 (映射确认) 完成后自动保存草稿
- 步骤 6 (执行提交) 每个 fill/upload 完成后更新草稿
- 用户取消: Agent 在用户说 "cancel" 时保存当前草稿, 询问 "是否保留草稿?"

恢复 Teaching:
- `bb-submitter teach <site> --product <name>` 检测到已有草稿时提示: "检测到未完成的 Teaching 草稿, 是否继续? (continue / restart)"
- continue: 从上次中断的步骤继续
- restart: 删除草稿, 重新开始

提交成功后草稿自动转为正式 knowledge YAML。

## Module 1: Product Data Store

每个 web 产品的物料，一次准备，到处复用。

### File Structure

```
products/<product-id>/
  product.yaml
  logo.png
  logo-256x256.png
  screenshots/
    hero.png
    dashboard.png
```

### Schema (product.yaml)

```yaml
name: "My SaaS App"
tagline: "One-liner value proposition"
description:
  short: "Under 200 chars"
  full: "Full description"
  zh: "中文简介"
url: "https://myapp.com"
category_tags: [AI, Productivity, Developer Tools]
tech_stack: [React, Node.js]
social:
  twitter: "@myapp"
  github: "myorg/myapp"
  producthunt: "myapp"
launch_date: 2026-01-15
pricing:
  model: freemium
  starting_price: "$9/mo"
contact_email: "submit@myapp.com"
```

- `category_tags` 是通用标签，不绑定任何站点分类，通过 Category Mapper 映射到各站具体分类
- 描述支持多语言，按站点需求自动选择
- 扩展字段：站点知识库可声明额外需要的字段
- 图片文件: Teaching 时如果站点要求特定尺寸而本地没有, Agent 提示用户准备或使用最接近的已有尺寸

## Module 2: Site Knowledge Base

经验积累的载体。每个导航站一条 YAML 记录。

### File: `knowledge/sites/<site-id>.yaml`

```yaml
site:
  name: "BetaList"
  url: "https://betabound.com/submit"

auth:
  method: "google_oauth"  # google_oauth | email_password | github | none

workflow:
  steps:
    - action: open
      target: "https://betabound.com/submit"
      wait_for: "@1 [h1] 'Submit Your Startup'"

    - action: click
      ref: "@3 [button] 'Continue with Google'"
      semantic: "[button]:has-text('Google')"
      wait: 3000
      human_intervention: "google_login"

    - action: fill
      field: "name"
      ref: "@2 [input] placeholder='Startup name'"
      semantic: "[input][placeholder*='name' i]"
      source: "product.name"

    - action: fill
      field: "description"
      ref: "@5 [textarea]"
      semantic: "[textarea][placeholder*='describe' i]"
      source: "product.description.full"

    - action: select_category
      ref: "@8 [select]"
      semantic: "[select] option:has-text('Category')"
      mapping:
        "AI": "artificial-intelligence"
        "Productivity": "productivity-tools"

    - action: upload
      field: "logo"
      ref: "@10 [input type='file']"
      semantic: "[input[type='file']][accept*='image' i]"
      source: "product.logo-256x256.png"

    - action: click
      ref: "@15 [button] 'Submit'"
      semantic: "[button]:has-text('Submit')"
      wait: 5000
      verify: "@1 [div] 'Submitted successfully'"

    - action: record_result
      confirmation_url: "get url"

known_quirks:
  - "提交后需要等待邮件确认"
  - "screenshot 最大 5 张"
last_validated: 2026-05-27
```

### Workflow Step Types

| Step | Purpose | Supports |
|------|---------|----------|
| `open` | 打开页面 | wait_for, verify (post-condition) |
| `click` | 点击元素 | wait, verify (post-condition) |
| `fill` | 填充输入框，source 指向 product 字段 | - |
| `upload` | 上传文件，source 指向 product 文件路径 | - |
| `select` | 下拉框选择(非分类类，如国家/语言)，value 直接指定 | - |
| `select_category` | 选择分类(含 mapping 表，与 select 的区别是走 Category Mapper) | - |
| `check` / `uncheck` | 勾选/取消复选框(如同意条款) | - |
| `press` | 发送按键(如 Enter/Tab) | - |
| `wait` | 等待指定时间或元素出现 | - |
| `verify` | 验证预期内容出现(独立 step，用于页面内容校验) | - |
| `eval` | 执行 JavaScript | - |
| `record_result` | 记录提交结果 URL | - |

**通用可选属性** (所有 action step 类型都支持):
- `human_intervention: "<reason>"` — 此步骤需要人工介入（OAuth 弹窗、验证码等）。执行器在此步骤暂停，通知用户，等待 'done'/'skip'/'retry' 指令
- `verify: "<ref> '<text>'"` — 此步骤执行后检查指定元素和文本是否出现，作为 post-condition 断言。仅 `open` 和 `click` 支持(因为它们是导航类 step)。其他场景的验证用独立 `verify` step

## Module 3: Submission Engine

### Teaching Mode

```
用户: bb-submitter teach <site> --product <name>

1. Agent 打开 submit 页面 (bb-browser open)
2. Agent 获取表单快照 (bb-browser snapshot -i)
3. Agent 分析表单元素，逐个识别字段语义
   (通过 label/placeholder/name/type 推断)
4. Agent 提出映射建议:
   "检测到 name 字段 @2 [input placeholder='Startup name'], 建议匹配 product.name
    检测到 description textarea @5, 建议匹配 product.description.full
    检测到 category select @8, 需要你提供映射关系
    检测到 logo upload @10, 建议匹配 product.logo-256x256.png"
5. 用户确认/调整 (多轮对话)
   → 自动保存草稿到 knowledge/sites/.drafts/<site>.yaml
6. Agent 执行填写提交 (bb-browser fill/upload/click)
   → 每步完成后更新草稿
7. 自动生成 Site Knowledge YAML (含 semantic selectors)
8. 用户确认后保存正式 knowledge YAML, 删除草稿
```

### Replay Mode

```
用户: bb-submitter submit <site> --product <name>

1. 加载 knowledge/sites/<site>.yaml
2. 加载 products/<product>/product.yaml
3. 逐步执行 workflow steps:
   - 每个 step 先用 ref 匹配, 失败用 semantic 降级, 再失败触发 Agent 介入
4. human_intervention 步骤暂停，通知用户
5. verify 失败暂停，Agent 判断错误类型并决定策略
6. 完成后记录到 Submission Tracker
```

### Batch Mode

```
用户: bb-submitter batch --product <name> [--sites s1,s2,...] [--timeout 30]

1. 检查 submissions/.batch-running 是否有未完成的 batch
   - 有 → 断点续跑
   - 无 → 新建, 初始化 site_queue
2. 遍历站点队列, 站点间间隔 5-10 秒(避免被反爬)
3. 跳过已有 success 记录的站
4. 逐个 Replay Mode 执行
5. 每完成一站立即写 Submission Tracker + 更新锁文件
6. human_intervention 排队, --timeout 后自动 skip
7. 失败站记录并跳过, 继续下一个
8. 全部完成删除锁文件
```

## Module 4: Human-in-the-Loop Handler

### 触发暂停的场景

- **OAuth 登录**: Google/GitHub 弹窗 → 通知 "请完成登录"
- **验证码**: reCAPTCHA/hCaptcha/滑块 → 通知 "请点击验证码"
- **意外跳转**: URL 不符预期 → 附带当前 snapshot
- **验证失败**: verify 文本未出现 → 显示实际页面内容, Agent 判断原因
- **文件上传失败**: 格式/大小不符 → Agent 分析限制并提示调整
- **DOM 重大变化**: ref 和 semantic 匹配都失败 → Agent 判断是否需要重新 Teaching

### 暂停协议

Agent 暂停时输出:

```
[intervention] BetaList: 需要完成 Google 登录
操作: 在浏览器中点击 Google 账号, 完成后输入 'done' 继续
或输入 'skip' 跳过此站, 'retry' 重试当前步骤
```

Batch Mode 中增加超时提示:

```
[intervention] BetaList: 需要完成验证码 (超时: 30分钟)
```

## Module 5: Submission Tracker

### 单一状态文件: `submissions/<product>.yaml`

同产品多次 batch 会更新同一个文件(合并模式), 保留 last_updated 和 history:

```yaml
product: myapp2
last_updated: 2026-05-27T10:30:00Z
entries:
  - site: betalist.com
    status: success
    confirmation_url: "https://..."
    submitted_at: 2026-05-27T10:15:00Z
  - site: indiehackers.com
    status: failed
    error: "Name already taken"
    attempted_at: 2026-05-27T10:30:00Z
    retry_count: 1
  - site: tenzuki.com
    status: pending
    reason: "验证码未完成, timeout"
status_summary:
  success: 45
  failed: 3
  pending: 12
  not_started: 40
```

Status 枚举: `success | failed | pending | not_started | needs_review`

## Module 6: Category Mapper

全局分类映射表，解耦产品通用标签和站点特定分类。

### File: `knowledge/category-mappings.yaml`

```yaml
global_tags:
  AI:
    betalist.com: "artificial-intelligence"
    producthunt.com: "Artificial Intelligence"
    indiehackers.com: "ai-ml"
  Developer Tools:
    betalist.com: "dev-tools"
    producthunt.com: "Developer Tools"
```

Teaching 时 Agent 遇到 category 选择器，会 snapshot 选项列表让用户确认映射，确认后写入全局映射表。同一 category 后续站点可直接复用。

## CLI Commands

```
bb-submitter teach <site> --product <name>    教学模式: 教 Agent 新站点
bb-submitter submit <site> --product <name>   单站提交
bb-submitter batch --product <name>           全量批量提交(支持断点续跑)
bb-submitter batch --product <name> \
  --sites s1,s2                               指定站点批量提交
  --timeout 30                                人工介入超时(分钟)
bb-submitter status --product <name>          查看产品提交进度
bb-submitter knowledge list                   列出已学站点
bb-submitter knowledge show <site>            查看站点知识

bb-submitter knowledge edit <site>            用 $EDITOR 打开 knowledge/sites/<site>.yaml
                                               编辑完后自动运行 validate 检查
                                               如 validate 返回 broken, 提示用户考虑重新 teach

bb-submitter knowledge validate <site>        检查站点知识是否仍有效
                                           (打开页面, 用 semantic selector 匹配每个 step, 报告 valid/partial/broken)
```

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript/Node.js | 与 bb-browser 同技术栈 |
| Data Format | YAML | 人类可读写，SL 足够 |
| Browser | bb-browser + Chrome | 复用用户登录态 |
| Agent | Claude Code Agent | 理解表单语义、生成知识 |
| Storage | File System + Git | 简单、可版本控制 |

## Data Flow Summary

```
Teaching:
  User → CLI → Agent analyzes form → User confirms mapping
  → Agent executes via bb-browser → Generates Site Knowledge YAML
  → Draft auto-saved at key checkpoints

Replay:
  User → CLI → Load Site Knowledge + Product Data
  → Deterministic executor replays via bb-browser(优先 ref, 降级 semantic)
  → If step fails: auto-retry(network) or Agent介入(DOM change) or human_intervention(captcha)
  → Record to Submission Tracker

Batch Resume:
  CLI → Check submissions/.batch-running
  → Resume from last site in queue
  → Update lock file after each site completion
```
