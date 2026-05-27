# bb-submitter Design Spec

## Overview

自动化提交 web 产品到 100+ 导航站的平台。核心思路：第一个产品提交时，Agent 学习表单结构并记录为结构化知识；后续产品提交时，直接读取知识库自动重放。

**核心指标**: 100+ 导航站, 10+ web 产品, 非一次性工具。

## System Architecture

```
CLI (bb-submitter)
  ├── Teaching Mode (学习)
  ├── Replay Mode (重放)
  └── Batch Mode (批量)
         │
         ▼
    bb-browser (Chrome automation)
         │
    ┌────┴────┬──────────────┐
    ▼         ▼              ▼
Product    Site          Submission
Data       Knowledge     Tracker
Store      Base
```

### Two Core Modes

- **Teaching Mode**: 用户 + Agent 协作完成首次提交，Agent 分析表单、提出字段映射建议，用户确认后自动执行，最终生成 Site Knowledge YAML
- **Replay Mode**: 读取 Site Knowledge + Product Data，自动完成所有步骤，仅在验证码/OAuth/异常时暂停

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
      wait: 3000
      human_intervention: "google_login"

    - action: fill
      field: "name"
      ref: "@2 [input] placeholder='Startup name'"
      source: "product.name"

    - action: fill
      field: "description"
      ref: "@5 [textarea]"
      source: "product.description.full"

    - action: select_category
      ref: "@8 [select]"
      mapping:
        "AI": "artificial-intelligence"
        "Productivity": "productivity-tools"

    - action: upload
      field: "logo"
      ref: "@10 [input type='file']"
      source: "product.logo-256x256.png"

    - action: click
      ref: "@15 [button] 'Submit'"
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

| Step | Purpose |
|------|---------|
| `open` | 打开页面，可选 wait_for |
| `click` | 点击元素（按钮、链接） |
| `fill` | 填充输入框，source 指向 product 字段 |
| `upload` | 上传文件，source 指向 product 文件路径 |
| `select_category` | 选择分类，含 mapping 表 |
| `human_intervention` | 暂停，人工介入（OAuth/验证码） |
| `wait` | 等待指定时间或元素出现 |
| `verify` | 验证预期内容出现 |
| `eval` | 执行 JavaScript |
| `record_result` | 记录提交结果 URL |

## Module 3: Submission Engine

### Teaching Mode

```
用户: bb-submitter teach <site> --product <name>

1. Agent 打开 submit 页面 (bb-browser open)
2. Agent 获取表单快照 (bb-browser snapshot -i)
3. Agent 分析表单元素，逐个识别字段语义
   (通过 label/placeholder/name/type 推断)
4. Agent 提出映射建议:
   "检测到 name 字段 @2, 建议匹配 product.name
    检测到 description textarea @5, 建议匹配 product.description.full
    检测到 category select @8, 需要你提供映射关系
    检测到 logo upload @10, 建议匹配 product.logo-256x256.png"
5. 用户确认/调整 (多轮对话)
6. Agent 执行填写提交 (bb-browser fill/upload/click)
7. 自动生成 Site Knowledge YAML
8. 用户确认后保存
```

### Replay Mode

```
用户: bb-submitter submit <site> --product <name>

1. 加载 knowledge/sites/<site>.yaml
2. 加载 products/<product>/product.yaml
3. 逐步执行 workflow steps
4. human_intervention 步骤暂停，通知用户
5. verify 失败暂停，显示实际页面内容
6. 完成后记录到 Submission Tracker
```

### Batch Mode

```
用户: bb-submitter batch --product <name> [--sites s1,s2,...]

1. 遍历站点列表（全部已知站 或 指定站点）
2. 跳过已有成功记录的站
3. 逐个 Replay Mode 执行
4. human_intervention 排队处理
5. 失败跳过，继续下一个
```

## Module 4: Human-in-the-Loop Handler

### 触发暂停的场景

- **OAuth 登录**: Google/GitHub 弹窗 → 通知 "请完成登录"
- **验证码**: reCAPTCHA/hCaptcha/滑块 → 通知 "请点击验证码"
- **意外跳转**: URL 不符预期 → 附带 snapshot
- **验证失败**: verify 文本未出现 → 显示实际内容
- **文件上传失败**: 格式/大小不符 → 提示调整

### 暂停协议

Agent 暂停时输出:

```
[intervention] BetaList: 需要完成 Google 登录
操作: 在浏览器中点击 Google 账号, 完成后输入 'done' 继续
或输入 'skip' 跳过此站, 'retry' 重试当前步骤
```

## Module 5: Submission Tracker

### File: `submissions/<date>-<product>.yaml`

```yaml
product: myapp2
date: 2026-05-27
entries:
  - site: betalist.com
    status: success
    confirmation_url: "https://..."
    submitted_at: 2026-05-27T10:15:00Z
  - site: indiehackers.com
    status: failed
    error: "Name already taken"
    attempted_at: 2026-05-27T10:30:00Z
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
bb-submitter batch --product <name>           全量批量提交
bb-submitter batch --product <name> \
  --sites s1,s2                               指定站点批量提交
bb-submitter status --product <name>          查看产品提交进度
bb-submitter knowledge list                   列出已学站点
bb-submitter knowledge show <site>            查看站点知识
bb-submitter knowledge edit <site>            手动编辑知识记录
bb-submitter knowledge validate <site>        检查站点知识是否仍有效
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

Replay:
  User → CLI → Load Site Knowledge + Product Data
  → Agent replays via bb-browser → Record to Submission Tracker
  → If human_intervention: pause, wait for user input
```
