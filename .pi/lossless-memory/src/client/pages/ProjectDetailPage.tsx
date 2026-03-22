import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

interface Node {
  id: string
  level: number
  type: string
  content: string
  tokenCount: number
  childIds?: string[]
}

interface Session {
  path: string
  messageCount: number
  lastActive: number
}

interface Message {
  id: string
  role: string
  content: string
  timestamp: number
}

export default function ProjectDetailPage() {
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (viewMode === 'graph' && nodes.length > 0) {
      drawGraph()
    }
  }, [viewMode, nodes])

  async function loadData() {
    try {
      const [nodesRes, sessionsRes] = await Promise.all([
        fetch('/api/lossless/nodes').then(r => r.json()),
        fetch('/api/lossless/sessions').then(r => r.json())
      ])
      
      if (nodesRes.data) setNodes(nodesRes.data)
      if (sessionsRes.data) setSessions(sessionsRes.data)
      setLoading(false)
    } catch (err) {
      console.error('[ProjectDetailPage] 加载失败:', err)
      setLoading(false)
    }
  }

  async function loadSessionMessages(sessionPath: string) {
    try {
      const res = await fetch(`/api/lossless/messages?path=${encodeURIComponent(sessionPath)}`)
      const data = await res.json()
      const validMessages = (data.data || []).filter((m: Message) => 
        m.content && m.content.trim().length > 0
      )
      if (validMessages) setMessages(validMessages)
      setSelectedSession(sessionPath)
      setSelectedNode(null)
    } catch (err) {
      console.error('加载消息失败:', err)
    }
  }

  function handleNodeClick(node: Node) {
    setSelectedNode(node)
    setSelectedSession(null)
    setMessages([])
  }

  function drawGraph() {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // 设置画布大小
    const width = canvas.width = canvas.offsetWidth * 2
    const height = canvas.height = 400 * 2
    ctx.scale(2, 2)
    
    // 清空画布
    ctx.fillStyle = '#0f0f1a'
    ctx.fillRect(0, 0, canvas.offsetWidth, 400)
    
    // 分离 L1 和 L2 节点
    const l2Nodes = nodes.filter(n => n.level === 2)
    const l1Nodes = nodes.filter(n => n.level === 1)
    
    const nodeWidth = 120
    const nodeHeight = 60
    const spacing = 20
    
    // 绘制 L2 节点（顶层）
    const l2Y = 60
    l2Nodes.forEach((node, i) => {
      const x = (canvas.offsetWidth - l2Nodes.length * (nodeWidth + spacing)) / 2 + i * (nodeWidth + spacing)
      drawNode(ctx, x, l2Y, nodeWidth, nodeHeight, node, 'L2')
    })
    
    // 绘制 L1 节点（下层）
    const l1Y = 200
    l1Nodes.forEach((node, i) => {
      const x = (canvas.offsetWidth - l1Nodes.length * (nodeWidth + spacing)) / 2 + i * (nodeWidth + spacing)
      drawNode(ctx, x, l1Y, nodeWidth, nodeHeight, node, 'L1')
    })
    
    // 绘制连接线
    ctx.strokeStyle = 'rgba(102,126,234,0.5)'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    
    l2Nodes.forEach(l2 => {
      const l2X = (canvas.offsetWidth - l2Nodes.length * (nodeWidth + spacing)) / 2
      l1Nodes.forEach((l1, i) => {
        const l1X = (canvas.offsetWidth - l1Nodes.length * (nodeWidth + spacing)) / 2 + i * (nodeWidth + spacing)
        
        ctx.beginPath()
        ctx.moveTo(l2X + nodeWidth / 2, l2Y + nodeHeight)
        ctx.lineTo(l1X + nodeWidth / 2, l1Y)
        ctx.stroke()
      })
    })
    
    ctx.setLineDash([])
  }

  function drawNode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, node: Node, label: string) {
    // 节点背景
    const gradient = ctx.createLinearGradient(x, y, x, y + h)
    if (node.level === 2) {
      gradient.addColorStop(0, 'rgba(0,217,255,0.9)')
      gradient.addColorStop(1, 'rgba(0,242,254,0.7)')
    } else {
      gradient.addColorStop(0, 'rgba(240,147,251,0.9)')
      gradient.addColorStop(1, 'rgba(245,87,108,0.7)')
    }
    
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 10)
    ctx.fill()
    
    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 2
    ctx.stroke()
    
    // 文字
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(label, x + w / 2, y + 20)
    
    ctx.font = '10px monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    const content = node.content.slice(0, 40) + (node.content.length > 40 ? '...' : '')
    ctx.fillText(content, x + w / 2, y + 40)
    
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.fillText(`${node.tokenCount} tokens`, x + w / 2, y + 55)
  }

  function getSessionName(path: string): string {
    const match = path.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/)
    if (match) return match[1].replace(/T/, ' ')
    return '会话'
  }

  function getRoleInfo(role: string) {
    switch (role) {
      case 'user': return { icon: '👤', label: '用户', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' }
      case 'assistant': return { icon: '🤖', label: '助手', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' }
      case 'toolResult': return { icon: '🔧', label: '工具', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' }
      default: return { icon: '📝', label: role, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30' }
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 backdrop-blur-sm px-6 py-4 border-b border-cyan-500/30">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
              ← 返回
            </button>
            <div>
              <h1 className="text-xl font-bold text-cyan-400">📂 项目详情</h1>
              <p className="text-xs text-gray-500">Lossless Memory - DAG 可视化</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                viewMode === 'list' ? 'bg-purple-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              📋 列表
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                viewMode === 'graph' ? 'bg-purple-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              🕸️ 图谱
            </button>
          </div>
          <div className="flex gap-6 text-sm text-gray-400">
            <div className="text-center">
              <div className="text-xl font-bold text-purple-400">{nodes.length}</div>
              <div>节点</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-pink-400">{sessions.length}</div>
              <div>会话</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-400">{messages.length}</div>
              <div>消息</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* 左侧：DAG 节点 */}
          <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30 overflow-hidden flex flex-col">
            <h3 className="text-lg font-bold text-purple-400 mb-4">🌳 DAG 节点</h3>
            {viewMode === 'graph' ? (
              <div className="flex-1 overflow-hidden">
                {nodes.length === 0 ? (
                  <div className="text-center text-gray-500 py-10">
                    <div className="text-4xl mb-2">🌱</div>
                    <p className="text-sm">还没有 DAG 节点</p>
                    <p className="text-xs mt-1 text-gray-400">发送 8+ 条消息生成</p>
                  </div>
                ) : (
                  <canvas ref={canvasRef} className="w-full" style={{ height: '400px' }} />
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {nodes.length === 0 ? (
                  <div className="text-center text-gray-500 py-10">
                    <div className="text-4xl mb-2">🌱</div>
                    <p className="text-sm">还没有 DAG 节点</p>
                    <p className="text-xs mt-1 text-gray-400">发送 8+ 条消息生成</p>
                  </div>
                ) : (
                  nodes.map(node => (
                    <div 
                      key={node.id} 
                      onClick={() => handleNodeClick(node)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedNode?.id === node.id 
                          ? 'border-purple-500/50 bg-purple-500/10' 
                          : 'border-gray-700 bg-gray-800/50 hover:border-purple-500/30'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          node.level === 2 ? 'bg-cyan-500/20 text-cyan-400' : 'bg-pink-500/20 text-pink-400'
                        }`}>L{node.level}</span>
                        <span className="text-xs text-gray-500">{node.tokenCount}t</span>
                      </div>
                      <p className="text-xs text-gray-300 line-clamp-2">{node.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 中间：会话列表 / 节点详情 */}
          <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 backdrop-blur-sm rounded-xl p-6 border border-cyan-500/30 overflow-hidden flex flex-col">
            <h3 className="text-lg font-bold text-cyan-400 mb-4">
              {selectedNode ? '📋 节点详情' : '💬 会话'}
            </h3>
            {selectedNode ? (
              <div className="flex-1 overflow-y-auto">
                <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className={`text-sm font-bold px-2 py-1 rounded ${
                      selectedNode.level === 2 ? 'bg-cyan-500/20 text-cyan-400' : 'bg-pink-500/20 text-pink-400'
                    }`}>L{selectedNode.level} {selectedNode.type === 'summary' ? '摘要' : '消息'}</span>
                    <span className="text-xs text-gray-500">{selectedNode.tokenCount} tokens</span>
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedNode.content}</p>
                </div>
                <div className="text-center text-gray-500 text-sm">
                  <button 
                    onClick={() => setSelectedNode(null)}
                    className="text-cyan-400 hover:text-cyan-300"
                  >
                    ← 返回会话列表
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {sessions.map((session, index) => (
                  <div 
                    key={index} 
                    onClick={() => loadSessionMessages(session.path)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedSession === session.path 
                        ? 'border-cyan-500/50 bg-cyan-500/10' 
                        : 'border-gray-700 bg-gray-800/50 hover:border-cyan-500/30'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-bold text-cyan-400">
                        💬 {getSessionName(session.path).split(' ')[0]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {session.messageCount} 条
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      🕐 {new Date(session.lastActive).toLocaleString('zh-CN')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右侧：消息内容 */}
          <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 backdrop-blur-sm rounded-xl p-6 border border-green-500/30 overflow-hidden flex flex-col">
            <h3 className="text-lg font-bold text-green-400 mb-4">💬 对话内容</h3>
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 py-10">
                <div className="text-4xl mb-2">👈</div>
                <p className="text-sm">点击左侧会话</p>
                <p className="text-xs mt-1 text-gray-400">查看对话内容</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {messages.map((msg, index) => {
                  const roleInfo = getRoleInfo(msg.role)
                  return (
                    <div key={index} className={`p-3 rounded-lg border ${roleInfo.bg} ${roleInfo.border}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-xs font-bold ${roleInfo.color}`}>
                          {roleInfo.icon} {roleInfo.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          🕐 {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 whitespace-pre-wrap break-words line-clamp-6">
                        {msg.content}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
