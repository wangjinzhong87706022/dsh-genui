# AGENTS.md

本仓库是 dsh-genui：DSH 的生成式 UI 渲染插件（dsh-ui 围栏 → 真实组件；echart/mermaid/3D 懒加载）。

## Git 推送规则

- **推送一律推 `fork`** = `https://github.com/wangjinzhong87706022/dsh-genui.git`。
- `origin`（`https://github.com/omdsh-dev/dsh-genui.git`）是上游，**无写权限（403）**，只 fetch 不 push——2026-09-28 曾误推 origin 六连败，规则以此为本。
- 姊妹仓 dsh-agp-askdata（E:\git\dsh-agp-askdata）推它的 `origin`（wangjinzhong87706022/dsh-agp-askdata）。两仓渲染协议联动，提交推送成对进行。
- 推送走代理 `HTTPS_PROXY=http://127.0.0.1:7897` + `http.sslBackend=schannel`；代理节点对上传流会停摆（GET 正常、push 卡死），用重试循环：`timeout 100 git -c http.sslBackend=schannel -c http.lowSpeedLimit=1 -c http.lowSpeedTime=45 push fork main`，失败重试，最多 6 次。

## 工程约定

- 客户端改动后必须 `pnpm run build` 重建 `lib/`——web 通过 symlink 加载本仓库，`lib/client.js` 是实际被服务的产物；只改 `src/` 不构建 = 线上跑旧代码。
- 模型可见的围栏 schema 改动（新字段/新 preset）三处同步：guard 的 validate 路径、repair 路径、`genui-runtime/schema.ts`。
- ECharts tooltip 一律 `renderMode: 'richText'`：节点名是模型输出，绝不进 HTML parser。
- `pnpm run test` 是本地最低验证线；SKILL.md frontmatter 有 6 条基线遗留失败（skill-md / skill-examples / plugin-genui 注册），与客户端改动无关，不因它们阻塞提交。
