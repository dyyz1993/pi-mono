import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGetProjects, useGetStats } from '@shared/hooks/useLosslessRPC'
import type { Project, OverviewStats } from '@shared/modules/lossless-memory'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { data: projects, loading: projectsLoading, error: projectsError, refresh: refreshProjects } = useGetProjects()
  const { data: stats, loading: statsLoading, error: statsError } = useGetStats()
  const [searchTerm, setSearchTerm] = useState('')

  const filteredProjects = (projects || []).filter((p: Project) => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.path.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 backdrop-blur-sm px-6 py-4 border-b border-cyan-500/30">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">🧠 Lossless Memory</h1>
            <p className="text-xs text-gray-400 mt-1">
              项目列表 · 
              <button 
                onClick={() => navigate('/stats')} 
                className="text-cyan-400 hover:text-cyan-300 ml-1"
              >
                📊 API 统计
              </button>
            </p>
          </div>
          {stats && (
            <div className="flex gap-4 text-sm text-gray-400">
              <div className="text-center">
                <div className="text-xl font-bold text-cyan-400">{stats.totalProjects}</div>
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

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-6">
        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索项目..."
            className="w-full max-w-md bg-gray-800 border border-purple-500/50 rounded-lg px-4 py-2 text-white focus:border-cyan-400 focus:outline-none"
          />
        </div>

        {/* Projects Grid */}
        <div className="h-full overflow-y-auto">
          {projectsLoading ? (
            <div className="text-center text-gray-400 py-20">加载中...</div>
          ) : projectsError ? (
            <div className="text-center text-red-400 py-20">
              <div className="text-5xl mb-4">❌</div>
              <p>加载失败：{projectsError}</p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center text-gray-500 py-20">
              <div className="text-5xl mb-4">🔍</div>
              <p>没有找到匹配的项目</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project: Project) => (
                <div
                  key={project.path}
                  onClick={() => navigate(`/project/${encodeURIComponent(project.path)}`)}
                  className="p-6 rounded-xl border bg-gray-800/50 border-gray-700 cursor-pointer hover:border-cyan-500/50 hover:bg-gray-800/70 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-cyan-400 group-hover:text-cyan-300 transition-colors">
                        📂 {project.name}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1 truncate">{project.path}</p>
                    </div>
                    <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      查看详情 →
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 bg-gray-900/50 rounded-lg">
                      <div className="text-2xl font-bold text-cyan-400">{project.sessionCount}</div>
                      <div className="text-xs text-gray-500 mt-1">会话</div>
                    </div>
                    <div className="text-center p-3 bg-gray-900/50 rounded-lg">
                      <div className="text-2xl font-bold text-pink-400">{project.messageCount}</div>
                      <div className="text-xs text-gray-500 mt-1">消息</div>
                    </div>
                    <div className="text-center p-3 bg-gray-900/50 rounded-lg">
                      <div className="text-lg font-bold text-purple-400">
                        {Date.now() - project.lastActive < 86400000 ? '今天' : 
                         Date.now() - project.lastActive < 172800000 ? '昨天' : 
                         new Date(project.lastActive).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">活跃</div>
                    </div>
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
