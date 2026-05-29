# Knowledge YAML Action 类型

`workflow.steps` 中的 action 是抽象描述（"做什么"），执行时映射为具体操作（"怎么做"）。ref 号每次 session 不同，yaml 中只记录字段名和取值逻辑，不写死 ref。

## Action 速查表

| action | 用途 | 执行方式 | 示例 |
|---|---|---|---|
| `open` | 打开页面 | `bb-browser open <target>` | `target: https://example.com/submit` |
| `fill` | 填写文本输入框 | `bb-browser fill`；React 受控组件用 NativeInputValueSetter + dispatchEvent | `field: name`, `source: product.name` |
| `click` | 点击按钮/链接/span | `bb-browser click`；React fiber 不响应时用 `pendingProps.onClick()` | `field: submit_button` |
| `select` | 原生 `<select>` 下拉 | `bb-browser select` | `field: pricing_model`, `source: product.pricing.model` |
| `select_category` | 多选分类（combobox 组件） | `bb-browser type` + `bb-browser press Enter` 逐个选择 | `value: Artificial intelligence` |
| `click_radio` | 单选按钮 | `bb-browser click`；受控组件用 fiber `pendingProps.onChange()` | `field: access`, `value: Open Source` |
| `upload` | 文件上传 | DataTransfer hack + `bb-browser eval` | `field: logo`, `source: product.logo` |
| `trigger_submit` | React 表单提交 | fiber `pendingProps.onSubmit()` | 用于 form.submit() 不生效的场景 |
| `check_badge` | React 受控 checkbox | fiber `pendingProps.onChange({target:{checked:true}})` | 用于 DOM click 不生效的场景 |
| `record_result` | 记录提交结果 | 写入 `submissions/` 目录 | 标记工作流终点 |
| `close_invite_dialog` | 关闭弹窗/对话框 | 查找弹窗中的 Cancel/Close 按钮并 click | 业务操作，视具体站点实现 |

## Ref 管理原则

- `ref` 字段仅用于记录"哪个元素"，方便人工阅读，执行时必须重新 snapshot 获取最新 ref
- 页面导航或动态加载后 ref 失效
- `source: product.xxx` 映射到 `products/<product>/product.yaml` 对应字段
- `value: "固定值"` 表示该字段不随产品变化
