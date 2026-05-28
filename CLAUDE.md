# bb-submitter 项目规则

## 浏览器工具
- 所有对外部网站的访问、表单填充、点击操作必须使用 `bb-browser` CLI，禁止使用 `chrome-devtools-mcp`
- 原因：bb-browser 使用本地 Chrome 实例，可保持登录状态和持久化会话
- 每次提交完成后必须清理浏览器标签页（关闭提交相关页面，只保留 about:blank）

## 图片上传
- 所有图片上传使用文件方式传递完整 base64，禁止通过 shell 变量传递
- 原因：大 base64 通过 `$VAR` 传递会被 shell 截断，导致文件损坏
- 正确方式：将 JS 脚本写入 `/tmp/` 临时文件，通过 `bb-browser eval "$(cat /tmp/script.js)"` 执行

## 表单填写
- Founder's Twitter 字段统一填写 `https://x.com/staluxy`，除非产品明确有其他 Twitter 账号

## SPA 表单通用技巧

目标站点多为 React/Vue SPA 应用，常规 DOM 操作经常不生效，需用以下模式：

### React 受控组件填值
普通 `fill` 命令对 React 受控组件无效时，使用 NativeInputValueSetter：
```js
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'new value');
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### React 表单提交
`form.submit()` 和 `requestSubmit()` 对 React Server Action 无效时，通过 React fiber 触发：
```js
const fiber = getFiberFromDOM(formElement);
fiber.pendingProps.onSubmit(/* event */);
```

### 文件上传 (DataTransfer)
SPA 的文件 input 无法通过 `fill` 设置文件路径，需用 DataTransfer hack：
```js
const dt = new DataTransfer();
const file = new File([base64ToUint8Array(base64Str)], 'logo.png', { type: 'image/png' });
dt.items.add(file);
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(el, dt.files);
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### Combobox 多选
shadcn 等组件库的 combobox 不支持直接 click 选项（会变为单选），用 `type` + `Enter`：
```bash
bb-browser type @ref "Category Name"
bb-browser press Enter
```

### 大脚本拆分
超过 2 分钟的脚本会超时，需拆分为多个 `bb-browser eval` 调用，每个调用完成一个独立步骤。

## 项目目录结构
- `knowledge/sites/` — 各目标站点的提交知识库（YAML格式），包含表单结构、工作流步骤、已知坑点。提交前先查阅对应站点的知识文件
- `products/` — 产品数据目录，每个产品一个子目录，包含 `product.yaml`（名称、描述、URL、分类、logo、截图等）和媒体资源文件
- `submissions/` — 提交记录目录，每次成功提交后记录提交详情（站点、产品、时间、结果）

## 知识沉淀
- 每次成功提交站点后，必须将经验记录到 `knowledge/sites/<site-name>.yaml`
- 每次成功提交后，必须在 `submissions/` 目录记录提交详情（站点、产品、提交时间、结果状态）
- 内容包括：表单字段映射、工作流步骤、遇到的坑（known_quirks）、验证日期（last_validated）

## 调试

提交失败或不生效时，使用 bb-browser 调试命令排查：

```bash
bb-browser network requests                  # 查看网络请求（确认 API 是否发出）
bb-browser network requests "api" --with-body # 过滤请求并查看请求/响应体
bb-browser console                           # 查看控制台输出（React 错误等）
bb-browser errors                            # 查看 JS 异常
```

常见排查路径：
1. `bb-browser network requests` — 确认表单提交的 API 请求是否发出、返回了什么
2. `bb-browser console` — 查看前端框架是否有报错
3. `bb-browser errors` — 查看 JS 异常
