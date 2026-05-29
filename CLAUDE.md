# bb-submitter: bb-browser cli 提交说明手册

## 浏览器工具
- **MUST:** use `bb-browser` CLI, **FORBIDDEN:** `chrome-devtools-mcp`
- 原因：bb-browser 使用本地 Chrome 实例，可保持登录状态和持久化会话
- 每次提交完成后必须清理浏览器标签页（关闭提交相关页面，只保留 about:blank）

## 图片上传
- 所有图片上传使用文件方式传递完整 base64，禁止通过 shell 变量传递
- 原因：大 base64 通过 `$VAR` 传递会被 shell 截断，导致文件损坏
- 正确方式：将 JS 脚本写入 `/tmp/` 临时文件，通过 `bb-browser eval "$(cat /tmp/script.js)"` 执行

## 表单填写
- Founder's Twitter 字段统一填写 `https://x.com/staluxy`，除非产品明确有其他 Twitter 账号

## 项目目录结构
- `knowledge/sites/` — 各目标站点的提交知识库（YAML格式），包含表单结构、工作流步骤、已知坑点。提交前先查阅对应站点的知识文件
- `products/` — 产品数据目录，每个产品一个子目录，包含 `product.yaml`（名称、描述、URL、分类、logo、截图等）和媒体资源文件
- `submissions/<product>.yaml` — 每个产品一个文件，记录已提交的站点和日期，提交前查此表避免重复提交

## 提交工作流

每次提交产品到目标站点，遵循三步走：

### 1. 提交前：对齐数据

- 查阅 `knowledge/sites/<site>.yaml`，确认该站点的表单结构、步骤、已知坑点
- 确认 `products/<product>/product.yaml` 包含了 workflow 中所有 `source: product.xxx` 引用的字段
- 确认 logo、截图等媒体文件已放入产品目录

### 2. 提交中：按步骤执行

- 按 knowledge yaml 的 `workflow.steps` 逐步操作
- 每个 step 的 `source: product.xxx` 直接从 product yaml 对应字段取值
- 文本输入用 `bb-browser fill`，React 受控组件参考 [SPA 表单通用技巧](docs/spa-form-techniques.md)
- 文件上传用 DataTransfer + `bb-browser eval`
- 遇到新问题不要硬闯，参考 `known_quirks` 或 [调试指南](docs/debugging.md) 排查

### 3. 提交后：沉淀经验

- 更新 `knowledge/sites/<site>.yaml`：
  - 补充新发现的坑到 `known_quirks`
  - 如 workflow 步骤有变，同步更新 `workflow.steps`
  - 更新 `last_validated` 为当前日期
- 在 `submissions/<product>.yaml` 追加 `site: date`

## 知识沉淀
- 每次成功提交站点后，必须将经验记录到 `knowledge/sites/<site-name>.yaml`
- 每次成功提交后，必须在 `submissions/<product>.yaml` 追加站点和日期
- 知识文件内容：表单字段映射、工作流步骤、遇到的坑（known_quirks）、验证日期（last_validated）

## 参考文档

| 文档 | 说明 |
|---|---|
| [docs/spa-form-techniques.md](docs/spa-form-techniques.md) | React 受控组件填值、fiber 表单提交、DataTransfer 上传、combobox 多选 |
| [docs/knowledge-yaml-actions.md](docs/knowledge-yaml-actions.md) | Knowledge yaml action 类型速查表与 ref 管理原则 |
| [docs/debugging.md](docs/debugging.md) | bb-browser 调试命令与排查路径 |
