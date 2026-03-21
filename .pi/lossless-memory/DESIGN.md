# Design Document

## Architecture Overview

This template implements a **monorepo-style architecture** with client/server separation while maintaining a single development port.

### Key Design Decisions

#### 1. Single-Port Development

- **Why**: Simplifies local development, no CORS issues
- **How**: `@hono/vite-dev-server` serves both React and Hono
- **Benefit**: Developer experience, type safety across boundary

#### 2. Hono RPC

- **Why**: End-to-end type safety between frontend and backend
- **How**: Shared types exported from `src/server/index.ts`
- **Benefit**: Compile-time error detection, better DX

#### 3. Modular Backend

- **Why**: Scalability, clear separation of concerns
- **How**: Feature-based modules (`module-todos/`, `module-chat/`, etc.)
- **Benefit**: Easy to add new features, maintainable codebase

#### 4. Zustand for State

- **Why**: Minimal boilerplate, no context provider hell
- **How**: Global store with selector hooks
- **Benefit**: Performance (minimal re-renders), simplicity

#### 5. Real-time Support

- **Why**: Modern apps need real-time features
- **How**: WebSocket (`$ws()`) and SSE (`$sse()`) with type safety
- **Benefit**: Type-safe real-time communication

## Module Pattern

Each backend module follows this structure:

```
module-{feature}/
├── routes/         # API endpoints (Hono RPC)
├── services/       # Business logic
└── __tests__/      # Unit tests
```

### Example: Adding a New Module

1. Create directory: `src/server/module-features/`
2. Add routes: `src/server/module-features/routes/features-routes.ts`
3. Add service: `src/server/module-features/services/feature-service.ts`
4. Add tests: `src/server/module-features/__tests__/feature-service.test.ts`
5. Register in `src/server/app.ts`:

```typescript
import { featureRoutes } from './module-features/routes/features-routes'
app.route('/api', featureRoutes)
```

**参考现有模块**:

- `src/server/module-todos/` - Todo 模块
- `src/server/module-admin/` - Admin 模块

## Real-time Architecture

### WebSocket (`$ws()`)

**Type Safety Flow**:

```
Server: WSProtocol Schema
    ↓
@hono/zod-openapi: TypedResponse
    ↓
Hono: ToSchemaOutput
    ↓
Client: $ws() → WSClient<Protocol>
    ↓
Developer: ws.call('method', params)  // Type-safe!
```

**Testing**: Requires real server (`createTestServer`)

### SSE (`$sse()`)

**Type Safety Flow**:

```
Server: SSEProtocol Schema
    ↓
@hono/zod-openapi: TypedResponse
    ↓
Hono: ToSchemaOutput
    ↓
Client: $sse() → SSEClient<Protocol>
    ↓
Developer: conn.on('event', handler)  // Type-safe!
```

**Testing**: No server needed, works with `app.fetch()`

### Comparison

| Feature   | WebSocket                  | SSE                              |
| --------- | -------------------------- | -------------------------------- |
| Direction | Bidirectional              | Unidirectional (server → client) |
| Methods   | `call()`, `emit()`, `on()` | `on()`, `onStatusChange()`       |
| Protocol  | `WSProtocol`               | `SSEProtocol`                    |
| Testing   | Requires server            | No server needed                 |
| Use Case  | Chat, gaming               | Notifications, feeds             |

## Testing Strategy

### Unit Tests

- Location: `src/**/__tests__/*.test.ts`
- Framework: Vitest
- Environment: `jsdom` (client), `node` (server)
- Coverage: Services, stores, utilities

### Integration Tests

- Location: `src/server/integration/*.test.ts`
- Framework: Vitest
- Environment: `node`
- Coverage: API endpoints

### WebSocket Tests

- Location: `src/server/module-chat/__tests__/*.test.ts`
- Framework: Vitest
- Environment: `node`
- Requires: `createTestServer()`

### SSE Tests

- Location: `src/server/module-notifications/__tests__/*.test.ts`
- Framework: Vitest
- Environment: `node`
- Requires: No server needed

### E2E Tests

- Location: `tests/e2e/*.spec.ts`
- Framework: Playwright
- Environment: Browser
- Coverage: User workflows

## Type Safety Flow

### HTTP API

```
┌─────────────────┐
│  Server Routes  │ ──export──> AppType
└─────────────────┘                          │
                                             │
┌─────────────────┐                          ▼
│  RPC Client     │ <──import── AppType
│  (Frontend)     │
└─────────────────┘
```

### WebSocket

```
┌─────────────────┐
│  WSProtocol     │ ──schema──> TypedResponse
└─────────────────┘                          │
                                             │
┌─────────────────┐                          ▼
│  $ws() Method   │ <──type inference──
│  (Frontend)     │
└─────────────────┘
```

### SSE

```
┌─────────────────┐
│  SSEProtocol    │ ──schema──> TypedResponse
└─────────────────┘                          │
                                             │
┌─────────────────┐                          ▼
│  $sse() Method  │ <──type inference──
│  (Frontend)     │
└─────────────────┘
```

## Database Schema

Using Drizzle ORM with SQLite:

```typescript
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})
```

## Performance Considerations

### Frontend

- **Selector Hooks**: Use precise selectors to minimize re-renders
- **Code Splitting**: Lazy load routes/components
- **Bundle Size**: Tree-shaking with Vite

### Backend

- **Connection Pooling**: Reuse database connections
- **Query Optimization**: Index frequently queried columns
- **Caching**: Consider Redis for production

### Real-time

- **WebSocket**: Connection pooling, message batching
- **SSE**: Automatic reconnection, event buffering

## Security Best Practices

1. **Input Validation**: Zod schemas on all endpoints
2. **SQL Injection**: Drizzle ORM parameterized queries
3. **CORS**: Whitelist origins in production
4. **Environment Variables**: Never commit `.env` files
5. **Error Messages**: Don't leak sensitive info
6. **WebSocket**: Validate all incoming messages
7. **SSE**: Rate limiting on event streams

## Migration Path

### From Mock to Real Backend

1. Set `USE_MOCK_SERVER = false` in `apiClient.ts`
2. Configure production API base URL
3. Deploy backend separately
4. Update CORS configuration

### From SQLite to PostgreSQL

1. Update `drizzle.config.ts`
2. Change `sqliteTable` to `pgTable`
3. Update column types
4. Run `drizzle-kit push`

### Adding Real-time Features

1. Define protocol schema (`WSProtocol` or `SSEProtocol`)
2. Create route with schema
3. Implement server-side logic
4. Use `$ws()` or `$sse()` on client
5. Add tests (with or without server)
