import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Session {
  path: string
  sessionCount: number
  messageCount: number
  lastActive: number
}

interface ProjectGroup {
  name: string
  path: string
  sessions: number
  messageCount: number
  lastActive: number
}

interface OverviewStats {
  totalProjects: number
  totalSessions: number
  totalNodes: number
  totalMessages: number
  totalTokens: number
}

function extractProjectName(path: string): string {
  const match = path.match(/\/sessions\/--Users-([^/]+)-Project-([^/]+)--/i)
  if (match) {
    const user = decodeURIComponent(match[1])
    const project = decodeURIComponent(match[2])
    return `${user}/${project}`
  }
  const parts = path.split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part && !part.endsWith('.jsonl')) {
      return decodeURIComponent(part.replace(/-/g, ' ')).split('_')[0]
    }
  }
  return '未知项目'
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useState(() => {
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  })

  async function loadData() {
    try {
      const [sessionsRes, statsRes] = await Promise.all([
        fetch('/api/lossless/sessions').then(r => r.json()),
        fetch('/api/lossless/stats').then(r => r.json())
      ])
      
      if (sessionsRes.data) setSessions(sessionsRes.data)
      if (statsRes.data) setStats(statsRes.data)
      setLoading(false)
    } catch (err) {
      console.error('[ProjectsPage] 加载数据失败:', err)
      setLoading(false)
    }
  }

  const projectGroups = sessions.reduce((acc, session) => {
    const projectName = extractProjectName(session.path)
    if (!acc[projectName]) {
      acc[projectName] = { name: projectName, path: session.path, sessions: 0, messageCount: 0, lastActive: 0 }
    }
    acc[projectName].sessions += 1
    acc[projectName].messageCount += session.messageCount || 0
    acc[projectName].lastActive = Math.max(acc[projectName].lastActive, session.lastActive)
    return acc
  }, {} as Record<string, ProjectGroup>)

  const projects = Object.values(projectGroups)
  const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 backdrop-blur-sm px-6 py-4 border-b border-cyan-500/30">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">🧠 Lossless Memory</h1>
            <p className="text-xs text-gray-400 mt-1">项目维度 · DAG 可视化</p>
          </div>
          {stats && (
            <div className="flex gap-4 text-sm text-gray-400">
              <div className="text-center">
                <div className="text-xl font-bold text-cyan-400">{projects.length}</div>
                <div>项目</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-pink-400">{stats.totalSessions}</div>
                <div>会话</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-purple-400">{stats.totalNodes}</div>
                <div>节点</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-green-400">{stats.totalTokens.toLocaleString()}</div>
                <div>Tokens</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <div className="mb-6">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索项目..."
            className="w-full max-w-md bg-gray-800 border border-purple-500/50 rounded-lg px-4 py-2 text-white focus:border-cyan-400 focus:outline-none"
          />
        </div>

        <div className="h-full overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-20">加载中...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center text-gray-500 py-20">
              <div className="text-5xl mb-4">📭</div>
              <p>还没有项目</p>
              <p className="text-sm mt-2 text-gray-400">启动 pi 创建第一个会话</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map(project => (
                <div
                  key={project.name}
                  onClick={() => navigate(`/project/${encodeURIComponent(project.path)}`)}
                  className="p-6 rounded-xl border bg-gray-800/50 border-gray-700 cursor-pointer hover:border-cyan-500/50 hover:bg-gray-800/70 transition-all"
                >
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-cyan-400">📂 {project.name}</h3>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {project.path.split('/').pop()?.slice(0, 50)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-3 bg-gray-900/50 rounded-lg">
                      <div className="text-2xl font-bold text-pink-400">{project.sessions}</div>
                      <div className="text-xs text-gray-500 mt-1">会话</div>
                    </div>
                    <div className="text-center p-3 bg-gray-900/50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-400">{project.messageCount}</div>
                      <div className="text-xs text-gray-500 mt-1">消息</div>
                    </div>
                    <div className="text-center p-3 bg-gray-900/50 rounded-lg">
                      <div className="text-lg font-bold text-green-400">
                        {Date.now() - project.lastActive < 86400000 ? '今天' : 
                         Date.now() - project.lastActive < 172800000 ? '昨天' : 
                         new Date(project.lastActive).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">活跃</div>
                    </div>
                  </div>
                  
                  <div className="mt-4 text-center text-xs text-cyan-400">
                    点击查看详情 →
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
