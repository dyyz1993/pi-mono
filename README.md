# Full Stack Monorepo Template

A modern full-stack monorepo template with React, TypeScript, Express, and Docker.

## Project Structure

```
.
├── packages/
│   ├── frontend/     # React + TypeScript + Vite
│   └── backend/      # Express + TypeScript
├── package.json      # Root package.json with workspaces
├── tsconfig.base.json
├── Dockerfile
├── Dockerfile.backend
├── docker-compose.yml
└── nginx.conf
```

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (optional)

## Quick Start

### Development

1. Install dependencies:
```bash
npm install
```

2. Start development servers:
```bash
npm run dev
```

This will start:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

### Production with Docker

```bash
docker-compose up --build
```

This will start:
- Frontend: http://localhost
- Backend: http://localhost:3001

## Available Scripts

### Root Level
- `npm run dev` - Start both frontend and backend in development mode
- `npm run build` - Build both packages
- `npm run lint` - Lint all packages
- `npm run test` - Run tests for all packages

### Frontend (packages/frontend)
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Backend (packages/backend)
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript
- `npm start` - Start production server

## Tech Stack

### Frontend
- React 19
- TypeScript
- Vite
- CSS3

### Backend
- Node.js
- Express
- TypeScript
- CORS enabled

### DevOps
- Docker
- nginx reverse proxy
- Multi-stage builds

## API Endpoints

- `GET /api/health` - Health check endpoint
- `GET /api/hello` - Returns a greeting message

## Environment Variables

### Backend
- `PORT` - Server port (default: 3001)
- `NODE_ENV` - Environment (development/production)

## Development Workflow

1. Create feature branch
2. Make changes
3. Run tests: `npm run test`
4. Run linter: `npm run lint`
5. Submit pull request

## License

MIT
