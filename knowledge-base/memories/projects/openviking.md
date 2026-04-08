# OpenViking Project

## Overview

OpenViking is a hierarchical knowledge base system for AI assistants and developers.

## Architecture

### Frontend
- React 19 + TypeScript
- Vite for build tooling
- TailwindCSS for styling
- React Router for routing

### Backend
- FastAPI + Python 3.11
- SQLite for storage
- RESTful API design

### Knowledge Structure
- Memories: User/Project context
- Resources: Reference materials
- Skills: Reusable procedures

## Development Status

### Completed ✅
- Basic project structure
- Monorepo setup
- Backend API endpoints
- Frontend UI framework
- Development tooling

### In Progress 🚧
- Knowledge browsing UI
- Search functionality
- Real-time updates

### Planned 📋
- WebSocket support
- Knowledge editing
- Version control
- Import/Export

## Key Decisions

1. **Storage Format**: Markdown files for human readability
2. **API Design**: RESTful with JSON responses
3. **Frontend**: React SPA for rich interactions
4. **Database**: SQLite for simplicity and portability

## Team Conventions

### Git Workflow
- Main branch: `main`
- Feature branches: `feature/*`
- Commit message: `type: description`

### Code Style
- Follow existing patterns
- Write self-documenting code
- Add comments for complex logic

## Resources

- [API Documentation](http://localhost:8000/docs)
- [Frontend UI](http://localhost:5173)
- [Project README](../../README.md)
