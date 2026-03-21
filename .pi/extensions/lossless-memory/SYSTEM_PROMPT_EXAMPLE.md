# Agent 系统提示词示例

## 场景 1: 新对话开始（只传 L2 高层摘要）

```markdown
# Context (从历史对话中检索的高层摘要)

## L2 高层摘要
ID: l2-001
内容：整个对话涵盖系统架构设计：API 规范、数据库优化、缓存策略、性能监控、安全认证、微服务拆分。关键技术决策：RESTful API、PostgreSQL+Redis、JWT+OAuth2.0、Prometheus+Grafana、按业务领域拆分。

覆盖的主题：
- API 设计
- 数据库优化
- 缓存策略
- 性能监控
- 安全认证
- 微服务架构

## 使用指南
- 如果用户问题与上述主题相关，请参考这些历史决策
- 如需更多细节，可以查询对应的 L1 基础摘要
```

---

## 场景 2: 用户问到具体主题（传 L2 + 相关 L1）

用户问："我们之前讨论的 API 认证是怎么设计的？"

```markdown
# Context (从历史对话中检索的相关摘要)

## L2 高层摘要
ID: l2-001
内容：整个对话涵盖系统架构设计：API 规范、数据库优化、缓存策略、性能监控、安全认证、微服务拆分。关键技术决策：RESTful API、PostgreSQL+Redis、JWT+OAuth2.0、Prometheus+Grafana、按业务领域拆分。

---

## L1 基础摘要 (与"API 认证"相关)
ID: l1-1
主题：API 设计
内容：API 设计：RESTful 规范，资源命名用名词复数，HTTP 状态码 200/201/400/404，URL 版本化/api/v1/，JWT+OAuth2.0 认证，Access Token 1 小时，Refresh Token 7 天。

关键词：API, RESTful, HTTP, 认证，OAuth2, JWT

引用路径：
- 父节点：l2-001
- 关联消息：8 条 (msg-1 到 msg-8)

---

## L1 基础摘要 (可能相关的其他主题)
ID: l1-5
主题：安全认证
内容：安全认证：JWT+OAuth2.0 双重认证，RBAC 权限控制，API 限流，SQL 注入防护，XSS 过滤，CSRF Token，敏感数据加密存储。

关键词：安全，认证，JWT, OAuth2, RBAC, SQL 注入，XSS

---

## 使用指南
- 用户询问的是 API 认证，主要参考 l1-1
- 如需了解详细的安全措施，参考 l1-5
- 如需查看具体的对话内容，可以展开相关消息
```

---

## 场景 3: 需要查看具体消息（传 L2 + L1 + 相关 L0）

用户问："当时我们说 JWT 有效期是多久来着？"

```markdown
# Context (从历史对话中检索的详细摘要和消息)

## L2 高层摘要
ID: l2-001
内容：整个对话涵盖系统架构设计：API 规范、数据库优化、缓存策略、性能监控、安全认证、微服务拆分。关键技术决策：RESTful API、PostgreSQL+Redis、JWT+OAuth2.0、Prometheus+Grafana、按业务领域拆分。

---

## L1 基础摘要 (直接相关)
ID: l1-1
主题：API 设计
内容：API 设计：RESTful 规范，资源命名用名词复数，HTTP 状态码 200/201/400/404，URL 版本化/api/v1/，JWT+OAuth2.0 认证，Access Token 1 小时，Refresh Token 7 天。

---

## L0 原始消息 (与"JWT 有效期"相关的消息)

### msg-7 (用户)
时间：2026-03-21 14:35:22
内容：认证方案用什么好？JWT 还是 Session？

### msg-8 (助手)
时间：2026-03-21 14:36:05
内容：建议 JWT+OAuth2.0 组合，JWT 有效期 1 小时，Refresh Token 7 天，安全性更好。

---

## 回答建议
根据历史记录，之前讨论的 JWT 有效期是 **1 小时**，Refresh Token 有效期是 **7 天**。
```

---

## 场景 4: 完整的数据结构（JSON 格式传给 Agent）

```json
{
  "context": {
    "summary": {
      "level": 2,
      "id": "l2-001",
      "content": "整个对话涵盖系统架构设计：API 规范、数据库优化、缓存策略、性能监控、安全认证、微服务拆分。关键技术决策：RESTful API、PostgreSQL+Redis、JWT+OAuth2.0、Prometheus+Grafana、按业务领域拆分。",
      "topics": ["API 设计", "数据库优化", "缓存策略", "性能监控", "安全认证", "微服务架构"],
      "keywords": ["系统架构", "API", "数据库", "缓存", "监控", "安全", "微服务"]
    },
    "details": [
      {
        "level": 1,
        "id": "l1-1",
        "topic": "API 设计",
        "content": "API 设计：RESTful 规范，资源命名用名词复数，HTTP 状态码 200/201/400/404，URL 版本化/api/v1/，JWT+OAuth2.0 认证，Access Token 1 小时，Refresh Token 7 天。",
        "keywords": ["API", "RESTful", "HTTP", "认证", "OAuth2", "JWT"],
        "citation": {
          "parent": "l2-001",
          "siblings": ["l1-2", "l1-3", "l1-4", "l1-5", "l1-6"],
          "messages": ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5", "msg-6", "msg-7", "msg-8"]
        }
      }
    ],
    "messages": [
      {
        "id": "msg-8",
        "role": "assistant",
        "content": "建议 JWT+OAuth2.0 组合，JWT 有效期 1 小时，Refresh Token 7 天，安全性更好。",
        "timestamp": "2026-03-21T14:36:05.000Z",
        "topic": "API 设计",
        "keywords": ["JWT", "OAuth2", "有效期", "安全"]
      }
    ]
  },
  "query": {
    "original": "JWT 有效期是多久？",
    "keywords": ["JWT", "有效期"],
    "matchedTopics": ["API 设计", "安全认证"],
    "relevanceScore": 0.95
  },
  "instructions": "基于以上历史对话上下文，回答用户的问题。如果上下文中包含答案，请直接引用；如果需要更多细节，请说明。"
}
```

---

## 提示词模板（推荐）

```markdown
# Role
你是一个有帮助的 AI 助手，正在与用户继续之前的对话。

# Context
以下是从历史对话中检索的相关摘要和消息：

{{context}}

# Query
用户的当前问题：{{userQuery}}

# Instructions
1. 仔细阅读上下文，理解之前讨论的内容和达成的决策
2. 基于上下文回答用户的问题
3. 如果上下文中包含具体答案，请直接引用（可以提及消息 ID 和时间）
4. 如果上下文只有摘要，可以说明"根据之前的摘要..."
5. 如果需要更多细节才能回答，请明确说明需要查看哪些具体的历史消息

# Response Format
- 简洁明了
- 引用具体的历史决策
- 如果不确定，诚实说明
```

---

## 实际使用示例

**用户**: "我们之前讨论的微服务拆分方案是什么？"

**系统** (构造提示词):
```markdown
# Context
## L2 高层摘要
整个对话涵盖系统架构设计：API 规范、数据库优化、缓存策略、性能监控、安全认证、微服务拆分...

## L1 基础摘要 (与"微服务"相关)
ID: l1-6
主题：微服务架构
内容：微服务架构：按业务领域拆分，服务发现用 Consul，API Gateway 统一入口，分布式链路追踪 Jaeger，配置中心 Apollo。

# Query
用户问题：我们之前讨论的微服务拆分方案是什么？

# Instructions
基于上下文回答...
```

**AI 助手**:
"根据之前的讨论，微服务拆分方案是：

1. **拆分原则**：按业务领域拆分，比如用户服务、订单服务、支付服务等
2. **服务发现**：使用 Consul 或 Nacos
3. **API 入口**：API Gateway 统一入口，负责认证、限流、路由
4. **链路追踪**：使用 Jaeger 进行分布式链路追踪
5. **配置中心**：推荐 Apollo 或 Nacos

这是从 L1-6 摘要中检索到的内容。如果需要查看当时具体的讨论细节，我可以展开相关的 8 条原始消息。"
```

