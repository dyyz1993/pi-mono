# OpenViking Knowledge Base

A personal knowledge management system inspired by Viking, with a beautiful web interface and RESTful API.

## 🎯 Features

- **Three Knowledge Types**: Memories, Resources, and Skills
- **Browse & Search**: Navigate through your knowledge base with ease
- **Beautiful UI**: Modern, responsive web interface
- **RESTful API**: Full-featured backend API
- **Markdown Storage**: All knowledge stored as readable Markdown files
- **Type-Safe**: Full TypeScript support on frontend

## 🏗️ Architecture

```
OpenViking/
├── packages/
│   ├── frontend/          # React + TypeScript + TailwindCSS
│   │   ├── src/
│   │   │   ├── components/   # Reusable UI components
│   │   │   ├── pages/        # Page components
│   │   │   ├── services/     # API client
│   │   │   └── types/        # TypeScript types
│   │   └── package.json
│   └── backend/           # FastAPI + Python
│       ├── app/
│       │   ├── routers/      # API endpoints
│       │   ├── models.py     # Data models
│       │   └── database.py   # Database config
│       └── requirements.txt
├── memories/              # User memories
│   ├── user/              # Personal profile
│   └── projects/          # Project context
├── resources/             # Reference materials
├── skills/                # Reusable procedures
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- pip or uv

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd OpenViking

# Install frontend dependencies
cd packages/frontend
npm install

# Install backend dependencies
cd ../backend
pip install -r requirements.txt

# Return to root
cd ../..
```

### Running the Application

#### Option 1: Using the start script

```bash
./start.sh
```

This will start both frontend and backend servers.

#### Option 2: Manual start

```bash
# Terminal 1: Start backend
cd packages/backend
python start.py

# Terminal 2: Start frontend
cd packages/frontend
npm run dev
```

### Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8001
- **API Documentation**: http://localhost:8001/docs

## 📚 Knowledge Types

### Memories (`memories/`)
Personal context and experiences:
- **User**: Profile, preferences, goals
- **Projects**: Project-specific context and learnings

### Resources (`resources/`)
Reference materials and documentation:
- Programming language guides
- Framework documentation
- Best practices
- Cheatsheets

### Skills (`skills/`)
Reusable procedures and workflows:
- Development workflows
- Testing procedures
- Deployment checklists
- Code review guidelines

## 🔍 API Endpoints

### Knowledge Endpoints
- `GET /api/memories` - List all memories
- `GET /api/memories/{path:path}` - Get specific memory
- `GET /api/resources` - List all resources
- `GET /api/resources/{path:path}` - Get specific resource
- `GET /api/skills` - List all skills
- `GET /api/skills/{path:path}` - Get specific skill

### Search Endpoints
- `POST /api/search` - Search all knowledge types
- `POST /api/search/memories` - Search memories only
- `POST /api/search/resources` - Search resources only
- `POST /api/search/skills` - Search skills only

### Health Check
- `GET /health` - Check server status

## 🎨 Frontend Routes

- `/` - Home page with quick links
- `/browse` - Browse all knowledge types
- `/browse/memories` - Browse memories
- `/browse/resources` - Browse resources
- `/browse/skills` - Browse skills
- `/view/*` - View specific knowledge item

## 📝 Adding Knowledge

### Create a Memory
```bash
# Create a project memory
cat > memories/projects/my-project.md << EOF
# My Project

## Description
A brief description of the project.

## Goals
- Goal 1
- Goal 2

## Context
Important context and decisions.

## Learnings
What I learned from this project.
EOF
```

### Create a Resource
```bash
# Create a resource
cat > resources/python-best-practices.md << EOF
# Python Best Practices

## Code Style
- Use Black for formatting
- Follow PEP 8 guidelines
- Use type hints

## Testing
- Write unit tests with pytest
- Aim for >80% coverage

## Documentation
- Use docstrings for all functions
- Keep README updated
EOF
```

### Create a Skill
```bash
# Create a skill
cat > skills/code-review-checklist.md << EOF
# Code Review Checklist

## Before Review
- [ ] Code compiles without errors
- [ ] All tests pass
- [ ] No linting errors

## During Review
- [ ] Code follows style guide
- [ ] Proper error handling
- [ ] Adequate documentation
- [ ] No security vulnerabilities

## After Review
- [ ] All comments addressed
- [ ] Final approval given
EOF
```

## 🔧 Development

### Frontend Development
```bash
cd packages/frontend
npm run dev      # Start dev server
npm run build    # Build for production
npm run lint     # Run linter
npm run typecheck # Type check
```

### Backend Development
```bash
cd packages/backend
python start.py  # Start dev server
pytest           # Run tests
black .          # Format code
mypy .           # Type check
```

## 📦 Tech Stack

### Frontend
- **React 18**: UI library
- **TypeScript**: Type safety
- **React Router**: Navigation
- **TailwindCSS**: Styling
- **Lucide React**: Icons
- **Vite**: Build tool

### Backend
- **FastAPI**: Web framework
- **SQLAlchemy**: ORM
- **SQLite**: Database
- **Pydantic**: Data validation
- **Uvicorn**: ASGI server

## 🤝 Contributing

This is a personal knowledge base system, but contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - feel free to use this for your own knowledge management!

## 🙏 Acknowledgments

Inspired by the Viking knowledge management system and the need for a simple, effective personal knowledge base.
