import React, { useState, useEffect } from 'react';

// ============================================
// 数据结构
// ============================================

interface Project {
  path: string;
  name: string;
  sessionCount: number;
  messageCount: number;
  lastActive: number;
}

interface Session {
  id: string;
  name: string;
  projectPath: string;
  messageCount: number;
  tokenCount: number;
  lastActive: number;
}

interface L2Node {
  id: string;
  level: 2;
  content: string;
  tokenCount: number;
  childIds: string[];
  topics: string[];
  keywords: string[];
}

interface L1Node {
  id: string;
  level: 1;
  content: string;
  tokenCount: number;
  parentIds: string[];
  siblingIds: string[];
  childIds: string[];
  topic: string;
  keywords: string[];
}

interface L0Message {
  id: string;
  level: 0;
  role: 'user' | 'assistant';
  content: string;
  tokenCount: number;
  parentL1: string;
  timestamp: number;
}

// ============================================
// Mock 数据
// ============================================

const MOCK_PROJECTS: Project[] = [
  { path: '/Users/xuyingzhou/Project/temporary/pi-mono', name: 'pi-mono', sessionCount: 3, messageCount: 126, lastActive: Date.now() },
  { path: '/Users/xuyingzhou/Project/study-desktop/my-react-tailwind-vite-app2', name: 'my-react-tailwind-vite-app2', sessionCount: 1, messageCount: 82, lastActive: Date.now() - 86400000 }
];

const MOCK_SESSIONS: Session[] = Array.from({length: 5}, (_, i) => ({
  id: `session-${i+1}`,
  name: `${new Date(Date.now() - i * 86400000).toLocaleDateString()} 的对话`,
  projectPath: '/Users/xuyingzhou/Project/temporary/pi-mono',
  messageCount: 20 + Math.floor(Math.random() * 30),
  tokenCount: 1000 + Math.floor(Math.random() * 2000),
  lastActive: Date.now() - i * 86400000
}));

const MOCK_L2: L2Node = {
  id: 'l2-001',
  level: 2,
  content: '本次会话讨论了前端项目的技术选型和架构设计。主要决策包括：采用 React 18 + TypeScript 作为核心技术栈，使用 TailwindCSS 进行样式开发，通过 Vite 实现快速构建和开发服务器。',
  tokenCount: 342,
  childIds: ['l1-1', 'l1-2', 'l1-3', 'l1-4'],
  topics: ['技术选型', '项目架构', '开发工具', '代码规范'],
  keywords: ['React', 'TypeScript', 'TailwindCSS', 'Vite', '前端', '架构']
};

const MOCK_L1: L1Node[] = [
  { id: 'l1-1', level: 1, content: '技术栈讨论：确定使用 React 18 作为 UI 框架，配合 TypeScript 5.x 提供类型安全。选择了 Vite 5.0 作为构建工具，样式方案采用 TailwindCSS 3.4。', tokenCount: 156, parentIds: ['l2-001'], siblingIds: ['l1-2', 'l1-3', 'l1-4'], childIds: Array.from({length:8},(_,i)=>`msg-${i+1}`), topic: '技术选型', keywords: ['React', 'TypeScript', 'Vite', 'TailwindCSS'] },
  { id: 'l1-2', level: 1, content: '项目架构设计：采用功能模块划分，分为用户管理、数据可视化、表单处理三大模块。状态管理选用 Zustand，路由使用 React Router v6。', tokenCount: 142, parentIds: ['l2-001'], siblingIds: ['l1-1', 'l1-3', 'l1-4'], childIds: Array.from({length:8},(_,i)=>`msg-${i+9}`), topic: '项目架构', keywords: ['架构', '模块划分', 'Zustand', 'React Router'] },
  { id: 'l1-3', level: 1, content: '开发环境配置：Node.js 版本要求 18.18+，使用 pnpm 作为包管理器。ESLint + Prettier 保证代码质量，Husky 实现提交前检查。', tokenCount: 138, parentIds: ['l2-001'], siblingIds: ['l1-1', 'l1-2', 'l1-4'], childIds: Array.from({length:8},(_,i)=>`msg-${i+17}`), topic: '开发工具', keywords: ['开发环境', 'Node.js', 'pnpm', 'ESLint'] },
  { id: 'l1-4', level: 1, content: '代码规范约定：组件采用函数式写法，使用 TypeScript 接口定义 Props。命名规范：组件 PascalCase，工具函数 camelCase。', tokenCount: 134, parentIds: ['l2-001'], siblingIds: ['l1-1', 'l1-2', 'l1-3'], childIds: Array.from({length:8},(_,i)=>`msg-${i+25}`), topic: '代码规范', keywords: ['代码规范', 'TypeScript', '命名规范'] }
];

const MOCK_L0: L0Message[] = Array.from({length: 32}, (_, i) => ({
  id: `msg-${i+1}`,
  level: 0,
  role: i % 2 === 0 ? 'user' : 'assistant' as 'user' | 'assistant',
  content: [
    '我想开始一个新的前端项目，应该用什么技术栈比较好？',
    '推荐 2026 年的主流前端技术栈：React 18.x、TypeScript 5.x、Vite 5.x、TailwindCSS 3.4+',
    '为什么推荐 Vite 而不是 Webpack？',
    'Vite 冷启动快，基于 ES Modules，无需打包即可启动，HMR 更快。',
    '状态管理用什么比较好？',
    '推荐使用 Zustand，轻量简洁，比 Redux 更易用。',
    '项目结构怎么组织？',
    '建议按功能模块划分：components、hooks、services、stores 等。'
  ][i % 8] || '消息内容...',
  tokenCount: 15 + Math.floor(Math.random() * 10),
  parentL1: `l1-${Math.floor(i / 8) + 1}`,
  timestamp: Date.now() - (32 - i) * 60000
}));

// ============================================
// 工具函数
// ============================================

function searchByKeyword(keyword: string, l2: L2Node, l1: L1Node[], l0: L0Message[]) {
  const lowerKeyword = keyword.toLowerCase();
  return {
    l2: (l2.keywords.some(k => k.toLowerCase().includes(lowerKeyword)) || l2.content.toLowerCase().includes(lowerKeyword)) ? [l2] : [],
    l1: l1.filter(n => n.keywords.some(k => k.toLowerCase().includes(lowerKeyword)) || n.content.toLowerCase().includes(lowerKeyword)),
    l0: l0.filter(m => m.content.toLowerCase().includes(lowerKeyword))
  };
}

function getNodeById(id: string, l2: L2Node, l1: L1Node[], l0: L0Message[]) {
  if (id.startsWith('l2-')) return l2;
  if (id.startsWith('l1-')) return l1.find(n => n.id === id) || null;
  if (id.startsWith('msg-')) return l0.find(m => m.id === id) || null;
  return null;
}

// ============================================
// DAG Canvas Component
// ============================================

function DAGCanvas({ l2, l1, l0, selectedNode, onSelectNode, showL0 }: { 
  l2: L2Node; 
  l1: L1Node[]; 
  l0: L0Message[];
  selectedNode: any;
  onSelectNode: (n: any) => void;
  showL0: boolean;
}) {
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
    const y = 50;
    const radius = 50;
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
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('L2', x, y-5);
    ctx.font = '9px monospace';
    ctx.fillText(l2.tokenCount+'t', x, y+15);

    // Draw L1
    const l1XStep = rect.width / (l1.length + 1);
    l1.forEach((node, i) => {
      const x = l1XStep * (i + 1);
      const y = 140;
      const radius = 40;
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
      ctx.fillText('L1', x, y-5);
      ctx.font = '8px monospace';
      ctx.fillText(node.tokenCount+'t', x, y+12);
    });

    // Draw L0
    if (showL0 && l0.length > 0) {
      const l0Cols = 8;
      const l0XStep = rect.width / l0Cols;
      const l0YStart = 220;
      const l0YStep = 22;
      
      l0.forEach((node, i) => {
        const col = i % l0Cols;
        const row = Math.floor(i / l0Cols);
        const x = l0XStep * (col + 0.5);
        const y = l0YStart + row * l0YStep;
        const radius = 7;
        const isSelected = selectedNode?.id === node.id;
        ctx.fillStyle = node.role === 'user' ? 'rgba(0,217,255,0.6)' : 'rgba(147,51,234,0.6)';
        if (isSelected) ctx.fillStyle = node.role === 'user' ? 'rgba(0,217,255,1)' : 'rgba(147,51,234,1)';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();
      });
    }

    // Draw lines
    ctx.strokeStyle = 'rgba(102,126,234,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,3]);
    l1.forEach((node) => {
      const x = l1XStep * (l1.indexOf(node) + 1);
      const y = 140;
      ctx.beginPath();
      ctx.moveTo(rect.width/2, 100);
      ctx.lineTo(x, y-40);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Click handler
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      const l2Selected = Math.sqrt((mx - rect.width/2)**2 + (my - 50)**2) < 50 ? l2 : null;
      if (l2Selected) { onSelectNode(l2Selected); return; }
      
      const l1Selected = l1.find((n, i) => {
        const x = l1XStep * (i + 1);
        return Math.sqrt((mx - x)**2 + (my - 140)**2) < 40;
      });
      if (l1Selected) { onSelectNode(l1Selected); return; }
      
      if (showL0) {
        const l0Cols = 8;
        const l0XStep = rect.width / l0Cols;
        const l0YStart = 220;
        const l0YStep = 22;
        const l0Selected = l0.find((n, i) => {
          const col = i % l0Cols;
          const row = Math.floor(i / l0Cols);
          const x = l0XStep * (col + 0.5);
          const y = l0YStart + row * l0YStep;
          return Math.sqrt((mx - x)**2 + (my - y)**2) < 7;
        });
        if (l0Selected) onSelectNode(l0Selected);
      }
    };

    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [l2, l1, l0, selectedNode, onSelectNode, showL0]);

  return <canvas ref={canvasRef} className="w-full h-full bg-gray-900/50 rounded-lg cursor-pointer hover:bg-gray-800/50 transition-colors" />;
}

// ============================================
// 主组件
// ============================================

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'projects' | 'dag' | 'search'>('projects');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);

  const showL0 = selectedNode?.level === 1;
  const l0Messages = showL0 ? MOCK_L0.filter(m => selectedNode.childIds.includes(m.id)) : [];

  const handleSearch = () => {
    if (!searchKeyword) return;
    const results = searchByKeyword(searchKeyword, MOCK_L2, MOCK_L1, MOCK_L0);
    setSearchResults(results);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 backdrop-blur-sm px-6 py-4 border-b border-cyan-500/30">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">🧠 Lossless Memory Dashboard</h1>
            <p className="text-xs text-gray-400 mt-1">项目维度 · DAG 可视化 · 搜索</p>
          </div>
          <div className="text-xs text-gray-400">
            {selectedNode ? `📌 ${selectedNode.id} (L${selectedNode.level})` : '💡 点击节点查看详情'}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Top Bar */}
        <div className="flex-shrink-0 px-6 py-4 space-y-4">
          {/* Tabs */}
          <div className="flex gap-4">
            <button onClick={()=>setActiveTab('projects')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeTab==='projects'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}>
              📁 项目列表
            </button>
            <button onClick={()=>setActiveTab('dag')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeTab==='dag'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}>
              🎨 DAG 图谱
            </button>
            <button onClick={()=>setActiveTab('search')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeTab==='search'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}>
              🔍 搜索
            </button>
          </div>

          {/* Search Bar */}
          {activeTab === 'search' && (
            <div className="flex gap-2">
              <input 
                type="text" 
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="输入关键词搜索..."
                className="flex-1 bg-gray-800 border border-purple-500/50 rounded-lg px-4 py-2 text-white focus:border-cyan-400 focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button onClick={handleSearch} className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-lg font-semibold">
                搜索
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden px-6 pb-4">
          <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel */}
            <div className="lg:col-span-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30 overflow-hidden flex flex-col">
              {activeTab === 'projects' ? (
                <>
                  <h3 className="text-lg font-bold text-purple-400 mb-4">📁 项目列表</h3>
                  <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                    {MOCK_PROJECTS.map(project => (
                      <div
                        key={project.path}
                        onClick={() => {
                          setSelectedProject(project.path);
                          setActiveTab('dag');
                        }}
                        className="p-4 rounded-lg border bg-gray-800/50 border-gray-700 cursor-pointer hover:border-cyan-500/50 transition-all"
                      >
                        <h4 className="font-bold text-cyan-400 mb-1">📂 {project.name}</h4>
                        <p className="text-xs text-gray-500 truncate mb-3">{project.path}</p>
                        <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                          <div><div className="text-lg font-bold text-cyan-400">{project.sessionCount}</div><div>会话</div></div>
                          <div><div className="text-lg font-bold text-pink-400">{project.messageCount}</div><div>消息</div></div>
                          <div><div className="text-lg font-bold text-purple-400">{new Date(project.lastActive).toLocaleDateString()}</div><div>活跃</div></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : activeTab === 'dag' ? (
                <>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-purple-400">🎨 DAG 图谱</h3>
                    <div className="text-xs text-gray-400">{showL0 ? `👁️ 显示 L0 (${l0Messages.length}条)` : '💡 点击 L1 显示 L0'}</div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <DAGCanvas l2={MOCK_L2} l1={MOCK_L1} l0={l0Messages} selectedNode={selectedNode} onSelectNode={setSelectedNode} showL0={showL0} />
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-purple-400 mb-4">🔍 搜索结果</h3>
                  <div className="flex-1 overflow-y-auto">
                    {searchResults ? (
                      <div className="space-y-6">
                        {searchResults.l2.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-cyan-400 mb-3">L2 高层摘要</h4>
                            {searchResults.l2.map((node: any) => (
                              <div key={node.id} onClick={()=>setSelectedNode(node)} className="p-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 cursor-pointer mb-3">
                                <div className="flex justify-between mb-2">
                                  <span className="text-sm font-bold text-cyan-400">{node.id}</span>
                                  <span className="text-xs text-gray-400">{node.tokenCount} tokens</span>
                                </div>
                                <p className="text-xs text-gray-300">{node.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {searchResults.l1.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-pink-400 mb-3">L1 基础摘要</h4>
                            {searchResults.l1.map((node: any) => (
                              <div key={node.id} onClick={()=>setSelectedNode(node)} className="p-4 rounded-lg border border-pink-500/30 bg-pink-500/10 cursor-pointer mb-3">
                                <div className="flex justify-between mb-2">
                                  <span className="text-sm font-bold text-pink-400">{node.id}</span>
                                  <span className="text-xs text-gray-400">{node.tokenCount} tokens</span>
                                </div>
                                <p className="text-xs text-gray-300">{node.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {searchResults.l0.length > 0 && (
                          <div>
                            <h4 className="text-sm font-bold text-gray-400 mb-3">L0 原始消息</h4>
                            <div className="space-y-2">
                              {searchResults.l0.slice(0, 20).map((msg: any) => (
                                <div key={msg.id} onClick={()=>setSelectedNode(msg)} className="p-3 rounded-lg border border-gray-700 bg-gray-800/50 cursor-pointer">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className={`text-xs px-2 py-1 rounded ${msg.role==='user'?'bg-cyan-500/20 text-cyan-400':'bg-purple-500/20 text-purple-400'}`}>
                                      {msg.role==='user'?'👤 用户':'🤖 助手'}
                                    </span>
                                    <span className="text-xs text-gray-500">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                                  </div>
                                  <p className="text-sm text-gray-300">{msg.content}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 py-20">
                        <div className="text-5xl mb-4">🔍</div>
                        <p>输入关键词搜索 DAG 节点和消息</p>
                      </div>
                    )}
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
                      <span className={`text-sm font-bold ${selectedNode.level===2?'text-cyan-400':selectedNode.level===1?'text-pink-400':'text-gray-400'}`}>
                        {selectedNode.level===2?'L2 高层摘要':selectedNode.level===1?'L1 基础摘要':'L0 原始消息'}
                      </span>
                      <button onClick={()=>setSelectedNode(null)} className="text-gray-400 hover:text-white text-2xl">×</button>
                    </div>
                    <div className="text-xs text-gray-500 font-mono">{selectedNode.id}</div>
                    <div className="bg-gray-800/50 rounded-lg p-4">
                      <p className="text-sm text-gray-300">{selectedNode.content}</p>
                    </div>
                    {selectedNode.level === 0 && (
                      <div className="flex gap-2 text-xs">
                        <span className={`px-2 py-1 rounded ${selectedNode.role==='user'?'bg-cyan-500/20 text-cyan-400':'bg-purple-500/20 text-purple-400'}`}>
                          {selectedNode.role==='user'?'👤 用户':'🤖 助手'}
                        </span>
                        <span className="text-gray-400">{new Date(selectedNode.timestamp).toLocaleTimeString()}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-cyan-400">{selectedNode.tokenCount||0}</div>
                        <div className="text-xs text-gray-400">Tokens</div>
                      </div>
                      {selectedNode.childIds && (
                        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-pink-400">{selectedNode.childIds.length}</div>
                          <div className="text-xs text-gray-400">子节点</div>
                        </div>
                      )}
                    </div>
                    {selectedNode.level === 1 && selectedNode.parentIds && (
                      <div className="border-t border-gray-700 pt-4">
                        <h4 className="text-sm font-bold text-cyan-400 mb-2">🔗 引用路径</h4>
                        <div className="text-xs space-y-2">
                          <div>
                            <span className="text-gray-500">父节点：</span>
                            <code className="bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">{selectedNode.parentIds[0]}</code>
                          </div>
                          <div>
                            <span className="text-gray-500">兄弟节点：</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {selectedNode.siblingIds.map((id: string) => (
                                <code key={id} className="bg-pink-500/20 text-pink-400 px-2 py-1 rounded text-xs">{id}</code>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-20">
                    <div className="text-5xl mb-4">👆</div>
                    <p className="mb-2">点击任意节点查看详情</p>
                    <p className="text-sm text-gray-400">
                      L2 → 查看所有子节点 (L1)<br/>
                      L1 → 查看父节点 (L2) 和兄弟节点 + 8 条消息<br/>
                      L0 → 查看单条消息详情
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
