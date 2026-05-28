# bb-submitter 项目规则

## 浏览器工具
- 所有对外部网站的访问、表单填充、点击操作必须使用 `bb-browser` CLI，禁止使用 `chrome-devtools-mcp`
- 原因：bb-browser 使用本地 Chrome 实例，可保持登录状态和持久化会话
- 每次提交完成后必须清理浏览器标签页（关闭提交相关页面，只保留 about:blank）

## 图片上传
- 所有图片上传使用文件方式传递完整 base64，禁止通过 shell 变量传递
- 原因：大 base64 通过 `$VAR` 传递会被 shell 截断，导致文件损坏
- 正确方式：将 JS 脚本写入 `/tmp/` 临时文件，通过 `cat` 读取 + `--code "$(cat file)"` 执行

## 表单填写
- Founder's Twitter 字段统一填写 `https://x.com/staluxy`，除非产品明确有其他 Twitter 账号
