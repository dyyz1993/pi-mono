"""
OpenViking Backend API
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

app = FastAPI(
    title="OpenViking API",
    description="Knowledge Base and Session Management API",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data directories
KNOWLEDGE_BASE_DIR = Path(__file__).parent.parent.parent.parent / "knowledge-base"
MEMORY_DIR = KNOWLEDGE_BASE_DIR / "memories"
RESOURCE_DIR = KNOWLEDGE_BASE_DIR / "resources"
SKILL_DIR = KNOWLEDGE_BASE_DIR / "skills"
SESSION_DIR = KNOWLEDGE_BASE_DIR / "sessions"


def get_all_files(directory: Path, extension: str = "md") -> List[Dict[str, Any]]:
    """获取目录下所有指定扩展名的文件"""
    files = []
    if not directory.exists():
        return files
    
    for file in directory.rglob(f"*.{extension}"):
        rel_path = file.relative_to(directory)
        stat = file.stat()
        files.append({
            "name": file.stem,
            "path": str(rel_path),
            "full_path": str(file),
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "type": file.parent.name
        })
    
    return sorted(files, key=lambda x: x["modified"], reverse=True)


def get_file_content(file_path: str, base_dir: Path) -> Optional[Dict[str, Any]]:
    """获取文件内容和元数据"""
    full_path = base_dir / file_path
    if not full_path.exists():
        return None
    
    stat = full_path.stat()
    content = full_path.read_text(encoding="utf-8")
    
    # Parse frontmatter if exists
    frontmatter = {}
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            import yaml
            try:
                frontmatter = yaml.safe_load(parts[1]) or {}
            except:
                pass
    
    return {
        "name": full_path.stem,
        "path": file_path,
        "content": content,
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "frontmatter": frontmatter
    }


@app.get("/")
async def root():
    """API root"""
    return {
        "name": "OpenViking API",
        "version": "0.1.0",
        "endpoints": {
            "memories": "/api/memories",
            "resources": "/api/resources", 
            "skills": "/api/skills",
            "sessions": "/api/sessions",
            "search": "/api/search"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/memories")
async def list_memories():
    """List all memories"""
    return get_all_files(MEMORY_DIR)


@app.get("/api/memories/{memory_path:path}")
async def get_memory(memory_path: str):
    """Get a specific memory"""
    result = get_file_content(memory_path, MEMORY_DIR)
    if not result:
        return {"error": "Memory not found"}
    return result


@app.get("/api/resources")
async def list_resources():
    """List all resources"""
    return get_all_files(RESOURCE_DIR)


@app.get("/api/resources/{resource_path:path}")
async def get_resource(resource_path: str):
    """Get a specific resource"""
    result = get_file_content(resource_path, RESOURCE_DIR)
    if not result:
        return {"error": "Resource not found"}
    return result


@app.get("/api/skills")
async def list_skills():
    """List all skills"""
    return get_all_files(SKILL_DIR)


@app.get("/api/skills/{skill_path:path}")
async def get_skill(skill_path: str):
    """Get a specific skill"""
    result = get_file_content(skill_path, SKILL_DIR)
    if not result:
        return {"error": "Skill not found"}
    return result


@app.get("/api/sessions")
async def list_sessions():
    """List all sessions"""
    sessions = []
    if not SESSION_DIR.exists():
        return sessions
    
    for session_dir in SESSION_DIR.iterdir():
        if session_dir.is_dir():
            meta_file = session_dir / "metadata.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text())
                    meta["path"] = session_dir.name
                    sessions.append(meta)
                except:
                    pass
    
    return sorted(sessions, key=lambda x: x.get("start_time", ""), reverse=True)


@app.get("/api/search")
async def search(q: str, limit: int = 10):
    """Search across all knowledge base"""
    results = {
        "memories": [],
        "resources": [],
        "skills": []
    }
    
    query_lower = q.lower()
    
    # Search memories
    for file in get_all_files(MEMORY_DIR):
        content_data = get_file_content(file["path"], MEMORY_DIR)
        if content_data and query_lower in content_data["content"].lower():
            results["memories"].append({
                **file,
                "snippet": content_data["content"][:200] + "..."
            })
            if len(results["memories"]) >= limit:
                break
    
    # Search resources
    for file in get_all_files(RESOURCE_DIR):
        content_data = get_file_content(file["path"], RESOURCE_DIR)
        if content_data and query_lower in content_data["content"].lower():
            results["resources"].append({
                **file,
                "snippet": content_data["content"][:200] + "..."
            })
            if len(results["resources"]) >= limit:
                break
    
    # Search skills
    for file in get_all_files(SKILL_DIR):
        content_data = get_file_content(file["path"], SKILL_DIR)
        if content_data and query_lower in content_data["content"].lower():
            results["skills"].append({
                **file,
                "snippet": content_data["content"][:200] + "..."
            })
            if len(results["skills"]) >= limit:
                break
    
    return results


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
