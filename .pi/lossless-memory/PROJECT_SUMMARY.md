# Project Template Summary

## Created Project Structure

A complete React + Hono full-stack application template following the project-framework architecture.

## Directory Structure

```
template/
├── src/
│   ├── client/                     # React Frontend
│   │   ├── App.tsx                # Main Todo List component
│   │   ├── main.tsx               # React entry point
│   │   ├── index.css              # Global styles
│   │   ├── components/
│   │   │   └── __tests__/         # Component tests
│   │   ├── stores/
│   │   │   ├── todoStore.ts       # Zustand state management
│   │   │   ├── notificationStore.ts # SSE notifications store
│   │   │   └── __tests__/
│   │   ├── services/
│   │   │   └── apiClient.ts       # Hono RPC client
│   │   ├── hooks/
│   │   │   └── useWS.ts          # WebSocket hook
│   │   └── pages/
│   │       └── NotificationPage.tsx
│   │
│   ├── server/                     # Hono Backend
│   │   ├── app.ts                 # Server entry with middleware
│   │   ├── module-todos/          # Todo feature module
│   │   │   ├── routes/
│   │   │   │   └── todos-routes.ts  # API endpoints (Hono RPC)
│   │   │   ├── services/
│   │   │   │   └── todo-service.ts  # Business logic
│   │   │   └── __tests__/
│   │   ├── module-chat/           # WebSocket chat module
│   │   │   ├── routes/
│   │   │   │   └── chat-routes.ts
│   │   │   ├── services/
│   │   │   │   └── chat-service.ts
│   │   │   └── __tests__/
│   │   ├── module-notifications/  # SSE notifications module
│   │   │   ├── routes/
│   │   │   │   └── notification-routes.ts
│   │   │   ├── services/
│   │   │   │   └── notification-service.ts
│   │   │   └── __tests__/
│   │   ├── core/                  # Core runtime
│   │   │   ├── runtime.ts         # Runtime adapter interface
│   │   │   ├── runtime-node.ts   # Node.js runtime
│   │   │   ├── runtime-cloudflare.ts # Cloudflare runtime
│   │   │   ├── realtime-core.ts   # Real-time core
│   │   │   ├── typed-runtime.ts  # Type-safe runtime
│   │   │   └── realtime-scanner.ts # Auto-register realtime
│   │   ├── middleware/             # Express middleware
│   │   │   ├── cors.ts
│   │   │   ├── logger.ts
│   │   │   ├── error-handler.ts
│   │   │   └── realtime-env.ts    # Realtime env middleware
│   │   ├── test-utils/
│   │   │   ├── test-client.ts     # Test client factory
│   │   │   └── test-server.ts     # Test server (WebSocket)
│   │   ├── entries/
│   │   │   ├── node.ts           # Node.js entry point
│   │   │   └── cloudflare.ts     # Cloudflare entry point
│   │   └── integration/
│   │       └── todos-api.test.ts  # Integration tests
│   │
│   └── shared/                     # Shared Types
│       ├── core/                   # Framework Layer
│       │   ├── ws-client.ts       # WebSocket client
│       │   ├── sse-client.ts      # SSE client
│       │   ├── api-schemas.ts    # API response schemas
│       │   ├── protocol-types.ts  # Protocol type utilities
│       │   └── index.ts          # Framework exports
│       ├── modules/               # Business Layer
│       │   ├── chat/
│       │   │   └── index.ts      # Chat protocol schema
│       │   ├── todos/
│       │   │   ├── schemas.ts    # Todo schemas
│       │   │   └── index.ts
│       │   └── notifications/
│       │       ├── schemas.ts    # Notification + SSE schemas
│       │       └── index.ts
│       └── schemas/               # Unified exports
│           └── index.ts
│
├── lint-scripts/
│   ├── config/
│   │   └── project.config.ts      # Validation config
│   ├── validators/
│   │   ├── client-rpc.validator.ts
│   │   ├── server-rpc.validator.ts
│   │   ├── imports.validator.ts
│   │   └── index.ts
│   └── validate-all.ts            # Pre-commit validation
│
├── eslint-rules/
│   ├── layer-boundary.js          # Framework/Business layer separation
│   ├── no-direct-ws-sse.js        # WebSocket/SSE protection
│   ├── protect-ws-sse-interface.js
│   ├── require-type-safe-test-client.js
│   ├── require-hono-chain-syntax.js
│   ├── no-ambiguous-file-paths.js
│   └── no-util-functions-in-service.js
│
├── .claude/
│   └── rules/
│       ├── project-rules.md
│       ├── client-component-rules.md
│       ├── client-service-rules.md
│       ├── zustand-rules.md
│       ├── websocket-rules.md
│       ├── sse-rules.md
│       ├── shared-types-rules.md
│       ├── layer-boundary-rules.md
│       ├── testing-standards.md
│       └── hono-testing-best-practices.md
│
└── Documentation
    ├── README.md                  # User-facing documentation
    ├── QUICKSTART.md              # Quick start guide
    ├── DESIGN.md                  # Architecture documentation
    └── CLAUDE.md                  # Claude Code guidelines
```

## Framework Layer vs Business Layer

The project has clear separation between framework and business layers:

### Framework Layer (`src/shared/core/`)

- Generic, reusable infrastructure code
- Examples: `ws-client.ts`, `sse-client.ts`, `api-schemas.ts`
- Should not be modified by business code directly

### Business Layer (`src/shared/modules/`)

- Business-specific schemas and protocols
- Examples: `chat/`, `todos/`, `notifications/`
- Organized by feature modules

## Key Features Implemented

### 1. Architecture

- ✅ Monorepo-style structure with client/server separation
- ✅ Shared types for end-to-end type safety
- ✅ Single-port development (3010) using @hono/vite-dev-server
- ✅ Modular backend with feature-based organization
- ✅ Framework layer vs Business layer separation

### 2. Frontend (React + Vite)

- ✅ React 18 with TypeScript
- ✅ Zustand state management
- ✅ Hono RPC for type-safe API calls
- ✅ Todo List UI with CRUD operations
- ✅ Error handling and loading states

### 3. Backend (Hono)

- ✅ Hono with OpenAPI/Swagger support
- ✅ Zod validation for all endpoints
- ✅ CORS and error handling middleware
- ✅ Module-based route organization
- ✅ Health check endpoint
- ✅ Middleware for realtime env

### 4. Real-time Features

- ✅ WebSocket support with `$ws()` method
- ✅ SSE support with `$sse()` method
- ✅ Type-safe real-time communication
- ✅ Runtime abstraction (Node.js / Cloudflare Workers)
- ✅ Auto-register realtime via scanner

### 5. Testing

- ✅ Vitest configuration for unit tests
- ✅ Integration tests for API endpoints
- ✅ WebSocket tests (requires server)
- ✅ SSE tests (no server needed)
- ✅ jsdom environment for client tests
- ✅ Node environment for server tests

### 6. Code Quality

- ✅ ESLint with TypeScript support
- ✅ Custom ESLint rules for WebSocket/SSE
- ✅ Layer boundary rules for framework/business separation
- ✅ Prettier for code formatting
- ✅ Pre-commit hooks with Husky
- ✅ Validation script for common issues
- ✅ lint-staged for efficient formatting

## API Endpoints

### Todos

- `GET /api/todos` - List all todos
- `GET /api/todos/:id` - Get todo by ID
- `POST /api/todos` - Create new todo
- `PUT /api/todos/:id` - Update todo
- `DELETE /api/todos/:id` - Delete todo

### WebSocket

- `GET /api/chat/ws` - WebSocket chat endpoint
  - RPC methods: `echo`, `ping`
  - Events: `notification`

### SSE

- `GET /api/notifications/stream` - SSE notifications endpoint
  - Events: `notification`, `ping`, `connected`

### Health

- `GET /health` - Health check
- `GET /` - Root endpoint with HTML
- `GET /docs` - OpenAPI documentation

## Data Models

### Todo

```typescript
interface Todo {
  id: number
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
}
```

### Notification

```typescript
interface AppNotification {
  id: string
  type: 'info' | 'warning' | 'success' | 'error'
  title: string
  message: string
  read: boolean
  createdAt: string
}
```

## Usage

### Installation

```bash
npm install
```

### Development

```bash
npm run dev  # Starts on http://localhost:3010
```

### Testing

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
```

### Build

```bash
npm run build
npm run preview
```

## Technical Highlights

### 1. Type Safety

- End-to-end type safety from database to UI
- Hono RPC provides compile-time validation
- Zod schemas for runtime validation
- Type-safe WebSocket and SSE

### 2. Real-time Features

- WebSocket: Bidirectional communication with RPC
- SSE: Unidirectional server-to-client streaming
- Type-safe protocols with Zod schemas

### 3. Framework/Business Layer Separation

- Clear boundaries enforced by ESLint
- Framework layer: reusable infrastructure
- Business layer: feature-specific code

### 4. Scalability

- Modular architecture easy to extend
- Feature-based organization
- Clear separation of concerns

### 5. Developer Experience

- Clear project structure
- Comprehensive documentation
- Automated code quality checks
- Easy onboarding for new developers

## Next Steps

To use this template for a new project:

1. Copy the template directory
2. Customize package.json (name, description)
3. Update environment variables
4. Modify the Todo module or create new modules
5. Add your own features following the established patterns
6. Update documentation as needed
