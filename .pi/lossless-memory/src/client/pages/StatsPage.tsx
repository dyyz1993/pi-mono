import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ApiUsage {
  date: string;
  embedding: {
    calls: number;
    tokens: number;
    model: string;
  };
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
  cost: {
    embedding: number;
    llm: number;
    total: number;
  };
}

// Mock 统计数据（实际应该从后端 API 读取）
const MOCK_STATS: ApiUsage[] = Array.from({length: 7}, (_, i) => {
  const date = new Date(Date.now() - (6 - i) * 86400000);
  return {
    date: date.toLocaleDateString(),
    embedding: {
      calls: Math.floor(Math.random() * 50) + 10,
      tokens: Math.floor(Math.random() * 10000) + 2000,
      model: 'Qwen/Qwen3-Embedding-8B'
    },
    llm: {
      calls: Math.floor(Math.random() * 30) + 5,
      inputTokens: Math.floor(Math.random() * 20000) + 5000,
      outputTokens: Math.floor(Math.random() * 10000) + 2000,
      model: 'pi-default'
    },
    cost: {
      embedding: Number((Math.random() * 0.5).toFixed(4)),
      llm: Number((Math.random() * 0.3).toFixed(4)),
      total: Number((Math.random() * 0.8).toFixed(4))
    }
  };
});

export default function StatsPage() {
  const navigate = useNavigate();
  const [selectedRange, setSelectedRange] = useState<'7d' | '30d'>('7d');

  const totalStats = MOCK_STATS.reduce((acc, day) => ({
    embeddingCalls: acc.embeddingCalls + day.embedding.calls,
    embeddingTokens: acc.embeddingTokens + day.embedding.tokens,
    llmCalls: acc.llmCalls + day.llm.calls,
    llmInputTokens: acc.llmInputTokens + day.llm.inputTokens,
    llmOutputTokens: acc.llmOutputTokens + day.llm.outputTokens,
    embeddingCost: acc.embeddingCost + day.cost.embedding,
    llmCost: acc.llmCost + day.cost.llm,
    totalCost: acc.totalCost + day.cost.total
  }), {
    embeddingCalls: 0,
    embeddingTokens: 0,
    llmCalls: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    embeddingCost: 0,
    llmCost: 0,
    totalCost: 0
  });

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
              <h1 className="text-2xl font-bold text-cyan-400">📊 API 调用统计</h1>
              <p className="text-xs text-gray-400 mt-1">向量服务 · LLM 调用 · 费用统计</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedRange('7d')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${selectedRange==='7d'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              最近 7 天
            </button>
            <button
              onClick={() => setSelectedRange('30d')}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${selectedRange==='30d'?'bg-gradient-to-r from-cyan-500 to-purple-500 text-white':'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              最近 30 天
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="h-full overflow-y-auto space-y-6">
          
          {/* Total Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {/* Vector Embedding Stats */}
            <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">🔧</div>
                <div>
                  <div className="text-sm text-gray-400">向量嵌入</div>
                  <div className="text-2xl font-bold text-purple-400">{totalStats.embeddingCalls}</div>
                  <div className="text-xs text-gray-500">调用次数 ({selectedRange})</div>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Token 消耗:</span>
                  <span className="text-gray-300">{totalStats.embeddingTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">费用估算:</span>
                  <span className="text-green-400">${totalStats.embeddingCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">模型:</span>
                  <span className="text-gray-300 truncate ml-2">Qwen3-Emb-8B</span>
                </div>
              </div>
            </div>

            {/* LLM Input Stats */}
            <div className="bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 backdrop-blur-sm rounded-xl p-6 border border-cyan-500/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">📝</div>
                <div>
                  <div className="text-sm text-gray-400">LLM 输入</div>
                  <div className="text-2xl font-bold text-cyan-400">{totalStats.llmInputTokens.toLocaleString()}</div>
                  <div className="text-xs text-gray-500">Token 消耗 ({selectedRange})</div>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">调用次数:</span>
                  <span className="text-gray-300">{totalStats.llmCalls.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">费用估算:</span>
                  <span className="text-green-400">${totalStats.llmCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">模型:</span>
                  <span className="text-gray-300 truncate ml-2">pi-default</span>
                </div>
              </div>
            </div>

            {/* LLM Output Stats */}
            <div className="bg-gradient-to-br from-pink-500/20 to-pink-500/5 backdrop-blur-sm rounded-xl p-6 border border-pink-500/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">💬</div>
                <div>
                  <div className="text-sm text-gray-400">LLM 输出</div>
                  <div className="text-2xl font-bold text-pink-400">{totalStats.llmOutputTokens.toLocaleString()}</div>
                  <div className="text-xs text-gray-500">Token 生成 ({selectedRange})</div>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">平均长度:</span>
                  <span className="text-gray-300">{Math.round(totalStats.llmOutputTokens / totalStats.llmCalls)} tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">输入输出比:</span>
                  <span className="text-gray-300">1:{(totalStats.llmOutputTokens / totalStats.llmInputTokens).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">效率评分:</span>
                  <span className="text-yellow-400">⭐⭐⭐⭐</span>
                </div>
              </div>
            </div>

            {/* Total Cost Stats */}
            <div className="bg-gradient-to-br from-green-500/20 to-green-500/5 backdrop-blur-sm rounded-xl p-6 border border-green-500/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl">💰</div>
                <div>
                  <div className="text-sm text-gray-400">总费用</div>
                  <div className="text-2xl font-bold text-green-400">${totalStats.totalCost.toFixed(4)}</div>
                  <div className="text-xs text-gray-500">累计消耗 ({selectedRange})</div>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">向量服务:</span>
                  <span className="text-green-300">${totalStats.embeddingCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">LLM 服务:</span>
                  <span className="text-green-300">${totalStats.llmCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">日均费用:</span>
                  <span className="text-green-300">${(totalStats.totalCost / 7).toFixed(4)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Usage Chart */}
          <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30">
            <h3 className="text-lg font-bold text-purple-400 mb-6">📈 每日调用趋势</h3>
            <div className="space-y-4">
              {MOCK_STATS.map((day, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="w-24 text-xs text-gray-400">{day.date}</div>
                  <div className="flex-1 flex items-center gap-2">
                    {/* Embedding Calls */}
                    <div className="flex-1 h-8 bg-gray-800/50 rounded-lg overflow-hidden relative">
                      <div 
                        className="h-full bg-gradient-to-r from-purple-500 to-purple-400 transition-all duration-500"
                        style={{width: `${Math.min((day.embedding.calls / 60) * 100, 100)}%`}}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-semibold">
                        🔧 {day.embedding.calls}
                      </div>
                    </div>
                    {/* LLM Calls */}
                    <div className="flex-1 h-8 bg-gray-800/50 rounded-lg overflow-hidden relative">
                      <div 
                        className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
                        style={{width: `${Math.min((day.llm.calls / 35) * 100, 100)}%`}}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-semibold">
                        💬 {day.llm.calls}
                      </div>
                    </div>
                    {/* Cost */}
                    <div className="w-20 text-right text-xs text-green-400 font-semibold">
                      ${day.cost.total.toFixed(4)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-8 mt-6 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gradient-to-r from-purple-500 to-purple-400 rounded" />
                <span>向量嵌入调用</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gradient-to-r from-cyan-500 to-cyan-400 rounded" />
                <span>LLM 调用</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded" />
                <span>费用 (USD)</span>
              </div>
            </div>
          </div>

          {/* Model Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Vector Model Stats */}
            <div className="bg-gradient-to-r from-purple-500/20 to-purple-500/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/30">
              <h3 className="text-lg font-bold text-purple-400 mb-4">🔧 向量模型详情</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">Qwen3-Embedding-8B</div>
                    <div className="text-xs text-gray-500">SiliconFlow API</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-purple-400">{totalStats.embeddingCalls}</div>
                    <div className="text-xs text-gray-500">总调用</div>
                  </div>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">平均 Token/调用</div>
                    <div className="text-xs text-gray-500">每次调用消耗</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-300">{Math.round(totalStats.embeddingTokens / totalStats.embeddingCalls)}</div>
                    <div className="text-xs text-gray-500">tokens</div>
                  </div>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">总 Token 消耗</div>
                    <div className="text-xs text-gray-500">{selectedRange}累计</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-300">{totalStats.embeddingTokens.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">tokens</div>
                  </div>
                </div>
              </div>
            </div>

            {/* LLM Model Stats */}
            <div className="bg-gradient-to-r from-cyan-500/20 to-cyan-500/5 backdrop-blur-sm rounded-xl p-6 border border-cyan-500/30">
              <h3 className="text-lg font-bold text-cyan-400 mb-4">💬 LLM 模型详情</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">pi-default (OpenViking)</div>
                    <div className="text-xs text-gray-500">本地部署模型</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-cyan-400">{totalStats.llmCalls}</div>
                    <div className="text-xs text-gray-500">总调用</div>
                  </div>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">输入/输出比</div>
                    <div className="text-xs text-gray-500">Token 效率</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-300">
                      1:{(totalStats.llmOutputTokens / totalStats.llmInputTokens).toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500">输出效率</div>
                  </div>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-gray-300">平均响应长度</div>
                    <div className="text-xs text-gray-500">每次生成</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-300">{Math.round(totalStats.llmOutputTokens / totalStats.llmCalls)}</div>
                    <div className="text-xs text-gray-500">tokens</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* API Configuration */}
          <div className="bg-gradient-to-r from-green-500/20 to-green-500/5 backdrop-blur-sm rounded-xl p-6 border border-green-500/30">
            <h3 className="text-lg font-bold text-green-400 mb-4">⚙️ API 配置信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-purple-400">🔧 向量服务 (SiliconFlow)</h4>
                <div className="text-xs space-y-1 text-gray-400">
                  <div className="flex justify-between">
                    <span>Base URL:</span>
                    <span className="text-gray-300 font-mono">https://api.siliconflow.cn/v1</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Model:</span>
                    <span className="text-gray-300 font-mono">Qwen/Qwen3-Embedding-8B</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dimensions:</span>
                    <span className="text-gray-300 font-mono">4096</span>
                  </div>
                  <div className="flex justify-between">
                    <span>价格:</span>
                    <span className="text-gray-300 font-mono">$0.001/1K tokens</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-cyan-400">💬 LLM 服务 (Pi Default)</h4>
                <div className="text-xs space-y-1 text-gray-400">
                  <div className="flex justify-between">
                    <span>Provider:</span>
                    <span className="text-gray-300 font-mono">OpenViking / pi-ai</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Model:</span>
                    <span className="text-gray-300 font-mono">gpt-4o-mini / local</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Context Window:</span>
                    <span className="text-gray-300 font-mono">128K tokens</span>
                  </div>
                  <div className="flex justify-between">
                    <span>价格:</span>
                    <span className="text-gray-300 font-mono">本地部署 (免费)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
