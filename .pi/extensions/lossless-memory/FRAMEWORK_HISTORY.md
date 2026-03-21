# 框架文件修改历史

本文件记录所有框架层代码的修改历史。

## 框架层路径

- `src/shared/core/`
- `src/server/core/`
- `src/server/entries/`
- `src/server/test-utils/`
- `src/server/index.ts`
- `src/client/services/`

## 使用说明

1. **初始化基准**: 运行 `npm run framework:init` 为所有框架文件添加基准 Hash
2. **修改框架文件**: 在文件顶部添加 `@framework-modify`、`@reason` 和 `@impact` 注释
3. **更新基准**: 运行 `npm run framework:update` 更新基准 Hash 并记录到本文件

## 修改记录

| 日期       | 文件                                          | 基准变更                            | 修改原因                                                     | 影响范围                                                                 | 审批人 |
| ---------- | --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ------ |
| 2026-03-21 | src/shared/core/sse-client.ts                 | bfe66a54cb969df5 → 0a1efed4372dadaa | 使用 fetch API 替代 EventSource，支持自定义 headers（认证）  | SSE 客户端现在支持 Authorization header                                  | -      |
| 2026-03-21 | src/shared/core/api-schemas.ts                | 295608e4d0c3a8de → e226e0ef8bf7d5c4 | [必填] 修改原因                                              | [必填] 影响范围                                                          | -      |
| 2026-03-21 | src/server/core/runtime-cloudflare.ts         | 7ec7c42affba3013 → 61609a9a0a7f2a0c | [必填] 修改原因                                              | [必填] 影响范围                                                          | -      |
| 2026-03-21 | src/server/core/index.ts                      | 8ff4e28aacac0e29 → 82eff0212fda8f63 | [必填] 修改原因                                              | [必填] 影响范围                                                          | -      |
| 2026-03-21 | src/server/core/durable-objects/RealtimeDO.ts | fba696125b04c4f6 → a6639465c6bc7806 | 重命名为 RealtimeDurableObject，使其更通用，不再绑定特定业务 | Cloudflare Workers 环境下的 SSE/WebSocket 实时通信功能                   | -      |
| 2026-03-21 | src/server/entries/node.ts                    | 6697f7f963c5f57c → 159d5e23f19e9793 | 添加 SPA 前端路由处理，区分开发/生产环境                     | 新增前端路由处理逻辑，/admin/\* 返回 admin.html，其他路由返回 index.html | -      |
| 2026-03-21 | src/server/entries/cloudflare.ts              | b31e6f04a2d9c702 → e350401421193896 | 统一错误响应格式为 JSON，确保所有错误都返回结构化数据        | 影响 Cloudflare Workers 环境的错误响应格式                               | -      |
| 2026-03-21 | src/server/test-utils/test-server.ts          | bcbd4088a299f939 → ecef67ddd440f5b9 | 修复 ReadableStream 类型检查，添加 null 检查以避免类型错误   | 测试工具中的流式响应处理更加健壮，避免运行时错误                         | -      |
| 2026-03-21 | src/server/test-utils/test-client.ts          | d16fe334284db1d7 → b18502d5cc33f07d | 添加 headers 参数支持，以便在测试中传递认证头                | 测试客户端现在支持自定义 headers，用于认证测试                           | -      |
| 2026-03-21 | src/client/services/apiClient.ts              | ab16e97716a7556e → 5517d7521a8bb458 | 添加客户端认证支持，自动在请求头中携带 Authorization token   | 影响所有客户端 API 请求，需要用户登录后才能访问受保护的接口              | -      |
| 2026-03-21 | src/server/index.ts                           | 13391b28b7c66ede → 8a40700e91824590 | 添加 AdminApiType 导出以支持客户端类型安全的 RPC 调用        | 导出 AdminApiType 供 admin 模块使用                                      | -      |
