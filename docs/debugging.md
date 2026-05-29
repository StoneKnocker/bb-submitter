# 调试指南

提交失败或不生效时，使用 bb-browser 调试命令排查。

## 调试命令

```bash
bb-browser network requests                  # 查看网络请求（确认 API 是否发出）
bb-browser network requests "api" --with-body # 过滤请求并查看请求/响应体
bb-browser console                           # 查看控制台输出（React 错误等）
bb-browser errors                            # 查看 JS 异常
```

## 常见排查路径

1. `bb-browser network requests` — 确认表单提交的 API 请求是否发出、返回了什么
2. `bb-browser console` — 查看前端框架是否有报错
3. `bb-browser errors` — 查看 JS 异常
