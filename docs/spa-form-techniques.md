# SPA 表单通用技巧

目标站点多为 React/Vue SPA 应用，常规 DOM 操作经常不生效，需用以下模式。

## React 受控组件填值

普通 `fill` 命令对 React 受控组件无效时，使用 NativeInputValueSetter：

```js
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'new value');
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

## React 表单提交

`form.submit()` 和 `requestSubmit()` 对 React Server Action 无效时，通过 React fiber 触发：

```js
const fiber = getFiberFromDOM(formElement);
fiber.pendingProps.onSubmit(/* event */);
```

## 文件上传 (DataTransfer)

SPA 的文件 input 无法通过 `fill` 设置文件路径，需用 DataTransfer hack：

```js
const dt = new DataTransfer();
const file = new File([base64ToUint8Array(base64Str)], 'logo.png', { type: 'image/png' });
dt.items.add(file);
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(el, dt.files);
el.dispatchEvent(new Event('change', { bubbles: true }));
```

## Combobox 多选

shadcn 等组件库的 combobox 不支持直接 click 选项（会变为单选），用 `type` + `Enter`：

```bash
bb-browser type @ref "Category Name"
bb-browser press Enter
```

## 大脚本拆分

超过 2 分钟的脚本会超时，需拆分为多个 `bb-browser eval` 调用，每个调用完成一个独立步骤。
