import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import realData from '../real-pi-data.json';

interface Session {
  id: string;
  name: string;
  messageCount: number;
  tokenCount: number;
  lastActive: number;
}

const MOCK_SESSIONS: Session[] = Array.from({length: 8}, (_, i) => ({
  id: `session-${i+1}`,
  name: `${new Date(Date.now() - i * 86400000).toLocaleDateString()} 的对话`,
  messageCount: 20 + Math.floor(Math.random() * 30),
  tokenCount: 1000 + Math.floor(Math.random() * 2000),
  lastActive: Date.now() - i * 86400000
}));

// DAG Canvas Component
function DAGCanvas({ l2, l1, selectedNode, onSelectNode }: any) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw L2
    const x = rect.width / 2;
    const y = 60;
    const radius = 55;
    const isSelected = selectedNode?.id === l2.id;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, isSelected ? 'rgba(0,217,255,1)' : 'rgba(79,172,254,0.9)');
    gradient.addColorStop(1, isSelected ? 'rgba(0,242,254,0.9)' : 'rgba(0,242,254,0.7)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(0,217,255,0.5)';
    ctx.lineWidth = isSelected ? 4 : 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('L2 摘要', x, y-8);
    ctx.font = '10px monospace';
    ctx.fillText(l2.tokenCount+'t', x, y+18);

    // Draw L1
    const l1XStep = rect.width / (l1.length + 1);
    l1.forEach((node: any, i: number) => {
      const x = l1XStep * (i + 1);
      const y = 180;
      const radius = 45;
      const isSelected = selectedNode?.id === node.id;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, isSelected ? 'rgba(255,107,157,1)' : 'rgba(240,147,251,0.9)');
      gradient.addColorStop(1, isSelected ? 'rgba(245,87,108,0.9)' : 'rgba(245,87,108,0.7)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(255,107,157,0.5)';
      ctx.lineWidth = isSelected ? 4 : 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.topic, x, y-8);
      ctx.font = '9px monospace';
      ctx.fillText(node.tokenCount+'t', x, y+15);
    });

    // Draw lines
    ctx.strokeStyle = 'rgba(102,126,234,0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4,4]);
    l1.forEach((node: any) => {
      const x = l1XStep * (l1.indexOf(node) + 1);
      ctx.beginPath();
      ctx.moveTo(rect.width/2, 115);
      ctx.lineTo(x, 135);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Click handler
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      if (Math.sqrt((mx - rect.width/2)**2 + (my - 60)**2) < 55) {
        onSelectNode(l2);
        return;
      }
      
      const l1Clicked = l1.find((n: any, i: number) => {
        const x = l1XStep * (i + 1);
        return Math.sqrt((mx - x)**2 + (my - 180)**2) < 45;
      });
      if (l1Clicked) onSelectNode(l1Clicked);
    };

    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [l2, l1, selectedNode, onSelectNode]);

  return <canvas ref={canvasRef} className="w-full h-full bg-gray-900/50 rounded-lg cursor-pointer" style={{minHeight: '280px'}} />;
}

export default function ProjectDetailPage() {
  const { projectPath } = useParams<{projectPath: string}>();
  const navigate = useNavigate();
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'sessions' | 'dag'>('dag');

  // 使用真实数据
  const l2 = realData.l2;
  const l1 = realData.l1;
  const l0 = realData.l0;

  const projectName = projectPath?.split('/').pop() || 'Unknown';
  const decodedPath = projectPath ? decodeURIComponent(projectPath) : '';

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 backdrop-blur-sm px-6 py-4 border-b border-cyan-500/30">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
              ← 返回
            </button>
            <div>
              <h1 className="text-xl font-bold text-cyan-400">📂 {projectName}</h1>
              <p className="text-xs text-gray-500 truncate max-w-md">{decodedPath}</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('dag')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${activeTab==='dag'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              🎨 DAG 图谱
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${activeTab==='sessions'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              💬 会话列表
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="lg:col-span-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30 overflow-hidden flex flex-col">
            {activeTab === 'dag' ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-purple-400">🎨 DAG 图谱 (真实 pi 数据)</h3>
                  <div className="text-xs text-gray-400">
                    💡 {l0.length} 条真实消息，包含 thinking/text/toolResult
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <DAGCanvas l2={l2} l1={l1} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-purple-400 mb-4">💬 会话列表</h3>
                <div className="flex-1 overflow-y-auto space-y-3">
                  {MOCK_SESSIONS.map(session => (
                    <div
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className={`p-4 rounded-lg border cursor-pointer transition-all ${
                        selectedSession?.id === session.id
                          ? 'bg-gradient-to-r from-cyan-500/20 to-cyan-500/5 border-cyan-500/50'
                          : 'bg-gray-800/50 border-gray-700 hover:border-purple-500/50'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex-1">
                          <h4 className="font-bold text-cyan-400 mb-1">{session.name}</h4>
                          <div className="text-xs text-gray-400">
                            {session.messageCount} 条消息 · {session.tokenCount} tokens
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(session.lastActive).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right: Details Panel */}
          <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30 overflow-hidden flex flex-col">
            <h3 className="text-lg font-bold text-purple-400 mb-4">📋 详情</h3>
            <div className="flex-1 overflow-y-auto">
              {selectedNode ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className={`text-sm font-bold ${selectedNode.level===2?'text-cyan-400':'text-pink-400'}`}>
                      {selectedNode.level===2?'L2 高层摘要':'L1 基础摘要'}
                    </span>
                    <button onClick={()=>setSelectedNode(null)} className="text-gray-400 hover:text-white text-2xl">×</button>
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{selectedNode.id}</div>
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedNode.content}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-cyan-400">{selectedNode.tokenCount}</div>
                      <div className="text-xs text-gray-400">Tokens</div>
                    </div>
                    {selectedNode.childIds && (
                      <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-pink-400">{selectedNode.childIds.length}</div>
                        <div className="text-xs text-gray-400">子节点</div>
                      </div>
                    )}
                  </div>
                  {selectedNode.level === 1 && selectedNode.childIds && (
                    <div className="border-t border-gray-700 pt-4 mt-4">
                      <h4 className="text-sm font-bold text-cyan-400 mb-3">📨 关联消息 ({selectedNode.childIds.length}条)</h4>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {l0.filter((m: any) => selectedNode.childIds.includes(m.id)).slice(0, 10).map((msg: any) => (
                          <div key={msg.id} className="p-3 rounded-lg border border-gray-700 bg-gray-900/50">
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex gap-1">
                                <span className={`text-xs px-2 py-1 rounded ${msg.role==='user'?'bg-cyan-500/20 text-cyan-400':'bg-purple-500/20 text-purple-400'}`}>
                                  {msg.role==='user'?'👤 用户':'🤖 助手'}
                                </span>
                                {msg.type && msg.type !== 'text' && (
                                  <span className="text-xs px-2 py-1 rounded bg-orange-500/20 text-orange-400">
                                    {msg.type === 'thinking' ? '💭 思考' : msg.type === 'toolResult' ? '🔧 工具' : msg.type}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-sm text-gray-300 whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedSession ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold text-cyan-400">会话详情</span>
                    <button onClick={()=>setSelectedSession(null)} className="text-gray-400 hover:text-white text-2xl">×</button>
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{selectedSession.id}</div>
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <p className="text-sm text-gray-300">{selectedSession.name}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-cyan-400">{selectedSession.messageCount}</div>
                      <div className="text-xs text-gray-400">消息</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-pink-400">{selectedSession.tokenCount}</div>
                      <div className="text-xs text-gray-400">Tokens</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-20">
                  <div className="text-5xl mb-4">👆</div>
                  <p>点击节点或会话查看详情</p>
                  <p className="text-sm mt-2 text-gray-400">
                    L2 → 查看所有子节点 (L1)<br/>
                    L1 → 查看父节点 (L2) 和兄弟节点 + 关联消息<br/>
                    消息类型：thinking/text/toolResult
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
