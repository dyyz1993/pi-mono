# Todo Application Template

A full-stack React + Hono application template with TypeScript, demonstrating best practices for monorepo-style architecture with single-port development.

## Features

- **Frontend**: React with TypeScript, Vite
- **Backend**: Hono with TypeScript
- **Database**: SQLite with Drizzle ORM
- **State Management**: Zustand
- **Real-time**: WebSocket + SSE support
- **Testing**: Vitest (unit + integration tests)
- **Code Quality**: ESLint, Prettier, pre-commit hooks
- **Type Safety**: End-to-end type safety with Hono RPC

## Architecture

```
src/
├── client/          # React frontend
│   ├── components/  # UI components
│   ├── stores/     # Zustand state management
│   ├── services/    # API clients (apiClient)
│   ├── hooks/      # Custom hooks
│   ├── pages/      # Page components
│   └── App.tsx
├── server/          # Hono backend
│   ├── module-todos/     # Todo module
│   ├── module-chat/      # WebSocket chat module
│   ├── module-notifications/ # SSE notifications module
│   ├── core/             # Core services (runtime, realtime)
│   ├── middleware/       # Express middleware
│   ├── test-utils/       # Test utilities
│   └── entries/          # Entry points (node.ts, cloudflare.ts)
└── shared/              # Shared types
    ├── core/             # Framework layer (ws-client, sse-client)
    ├── modules/          # Business layer (chat, todos, notifications)
    └── schemas/          # Unified exports
```

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The application will be available at http://localhost:3010

### Build

```bash
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration
```

## Key Concepts

### Path Aliases

- `@shared/*` → src/shared/\*
- `@client/*` → src/client/\*
- `@server/*` → src/server/\*

### Single-Port Development

Uses "@hono/vite-dev-server" to run both frontend and backend on port 3010.

### Framework Layer vs Business Layer

The project has clear separation between framework and business layers:

- **Framework Layer** (`src/shared/core/`): Generic, reusable infrastructure
- **Business Layer** (`src/shared/modules/`): Business-specific schemas and protocols

### Hono RPC

Provides type-safe API calls from frontend to backend:

```typescript
import { apiClient } from '@client/services/apiClient'

// HTTP API
const response = await apiClient.api.todos.$get()
const result = await response.json()

// WebSocket
const ws = apiClient.api.chat.ws.$ws()
const result = await ws.call('echo', { message: 'hello' })

// SSE
const conn = await apiClient.api.notifications.stream.$sse()
conn.on('notification', n => console.log(n))
```

### Real-time Features

| Feature   | Method              | Type Safety | Testing          |
| --------- | ------------------- | ----------- | ---------------- |
| HTTP API  | `$get()`, `$post()` | ✅          | No server needed |
| WebSocket | `$ws()`             | ✅          | Requires server  |
| SSE       | `$sse()`            | ✅          | No server needed |

### Module Structure

Backend is organized by feature modules:

- `module-todos/` - Todo CRUD
- `module-chat/` - WebSocket chat
- `module-notifications/` - SSE notifications

Each module contains:

- `routes/` - API endpoints
- `services/` - Business logic
- `__tests__/` - Unit tests

## Pre-commit Hooks

The project uses Husky for Git hooks:

- **lint-staged** - Format staged files
- **npm test** - Run test suite
- **validate-all** - Custom validation script

## Environment Variables

See `.env.example` for required environment variables.

## Documentation

- `QUICKSTART.md` - Quick start guide
- `DESIGN.md` - Technical architecture
- `CLAUDE.md` - Development guidelines
- `.claude/rules/` - Detailed development constraints
