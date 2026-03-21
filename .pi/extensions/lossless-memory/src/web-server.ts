/**
 * Lossless Memory - Web 可视化后台服务
 * 端口：17337
 * PID 文件：~/.pi/agent/lossless-memory-web.pid
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { MemoryDatabase } from "./database.js";
import { DAGManager } from "./dag-manager.js";

const PORT = 17337;
const PID_FILE = join(homedir(), ".pi/agent/lossless-memory-web.pid");
const DB_PATH = join(homedir(), ".pi/agent/lossless-memory.db");
const TRACE_FILE = "/tmp/lossless-context-trace.jsonl";

const HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Lossless Memory Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;background:#1a1a2e;color:#eee;padding:20px}
.header{text-align:center;padding:20px;margin-bottom:20px;background:rgba(255,255,255,0.1);border-radius:10px}
.header h1{color:#00d9ff;margin-bottom:10px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px}
.stat-card{background:rgba(255,255,255,0.1);padding:20px;border-radius:10px;text-align:center;border-left:4px solid #00d9ff}
.stat-value{font-size:2em;font-weight:bold;color:#00d9ff}.stat-label{color:#aaa;margin-top:5px}
.dag-container{background:rgba(255,255,255,0.05);padding:20px;border-radius:10px;margin-bottom:20px}
.dag-tree{display:flex;flex-direction:column;align-items:center;gap:20px}
.dag-level{display:flex;gap:15px;flex-wrap:wrap;justify-content:center}
.dag-node{background:linear-gradient(135deg,#667eea,#764ba2);padding:15px;border-radius:8px;max-width:300px;cursor:pointer}
.dag-node:hover{transform:translateY(-2px);box-shadow:0 5px 20px rgba(102,126,234,0.4)}
.dag-node.l1{background:linear-gradient(135deg,#f093fb,#f5576c)}
.dag-node.l2{background:linear-gradient(135deg,#4facfe,#00f2fe)}
.dag-node-id{font-size:0.8em;color:rgba(255,255,255,0.6)}
.dag-node-content{font-size:0.9em;margin:5px 0}.dag-node-tokens{font-size:0.8em;color:rgba(255,255,255,0.8)}
.trace-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
.trace-item{background:rgba(255,255,255,0.05);padding:10px;border-radius:5px;border-left:3px solid #00d9ff}
.search-box{display:flex;gap:10px;margin-bottom:20px}
.search-box input{flex:1;padding:10px;background:rgba(255,255,255,0.1);border:none;border-radius:5px;color:#eee}
.search-box button{padding:10px 20px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:5px;color:white;cursor:pointer}
.search-results{display:grid;gap:10px}.search-result{background:rgba(255,255,255,0.05);padding:15px;border-radius:5px}
.log-container{background:rgba(0,0,0,0.3);padding:15px;border-radius:10px;max-height:200px;overflow-y:auto;font-size:0.9em}
.log-entry{padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.1)}
.log-time{color:#00d9ff;margin-right:10px}.refresh-btn{position:fixed;top:20px;right:20px;padding:10px 20px;background:linear-gradient(135deg,#11998e,#38ef7d);border:none;border-radius:5px;color:white;cursor:pointer}
.section-title{color:#00d9ff;margin:20px 0 10px;font-size:1.5em}
</style></head><body>
<button class="refresh-btn" onclick="loadData()">🔄刷新</button>
<div class="header"><h1>🧠 Lossless Memory Dashboard</h1><p>实时 DAG 可视化</p></div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-value" id="totalNodes">-</div><div class="stat-label">总节点数</div></div>
<div class="stat-card"><div class="stat-value" id="maxLevel">-</div><div class="stat-label">最大层级</div></div>
<div class="stat-card"><div class="stat-value" id="totalTokens">-</div><div class="stat-label">总 Token</div></div>
<div class="stat-card"><div class="stat-value" id="sessionCount">-</div><div class="stat-label">会话数</div></div>
</div>
<h2 class="section-title">🌳 DAG 结构</h2><div class="dag-container"><div class="dag-tree" id="dagTree">加载中...</div></div>
<h2 class="section-title">🔍 搜索</h2>
<div class="search-box"><input id="searchInput" placeholder="输入关键词..."/><button onclick="search()">搜索</button></div>
<div class="search-results" id="searchResults"></div>
<h2 class="section-title">📊 实时跟踪</h2><div class="trace-list" id="traceList">加载中...</div>
<h2 class="section-title">📝 日志</h2><div class="log-container" id="logContainer"></div>
<script>
async function loadData(){try{const r=await fetch('/api/data');const d=await r.json();
document.getElementById('totalNodes').textContent=d.stats.nodeCount||0;
document.getElementById('maxLevel').textContent='L'+(d.stats.maxLevel||0);
document.getElementById('totalTokens').textContent=d.stats.totalTokens||0;
document.getElementById('sessionCount').textContent=d.stats.sessionCount||0;
updateDAG(d.nodes);updateTrace(d.trace);updateLogs(d.logs||[]);}catch(e){console.error(e)}}
function updateDAG(nodes){const c=document.getElementById('dagTree');
if(!nodes||nodes.length===0){c.innerHTML='<p style="text-align:center;color:#aaa">暂无节点</p>';return;}
const levels={};nodes.forEach(n=>{if(!levels[n.level])levels[n.level]=[];levels[n.level].push(n);});
let h='';Object.keys(levels).sort((a,b)=>b-a).forEach(l=>{h+='<div class="dag-level">';
levels[l].forEach(n=>{h+='<div class="dag-node l'+l+'" title="'+esc(n.content)+'"><div class="dag-node-id">L'+l+'|'+n.id.slice(0,8)+'...</div><div class="dag-node-content">'+esc(n.content.slice(0,80))+'...</div><div class="dag-node-tokens">'+n.tokenCount+' tokens</div></div>';});
h+='</div>';if(parseInt(l)>0)h+='<div style="height:20px;width:2px;background:#667eea;margin:0 auto"></div>';});
c.innerHTML=h||'<p>暂无数据</p>';}
function updateTrace(t){const c=document.getElementById('traceList');
if(!t||t.length===0){c.innerHTML='<p style="color:#aaa">暂无记录</p>';return;}
c.innerHTML=t.map(x=>'<div class="trace-item"><strong>第'+x.turn+'轮</strong><br/>'+x.messages+'条 | '+x.totalTokens+' tokens</div>').join('');}
function updateLogs(logs){const c=document.getElementById('logContainer');
c.innerHTML=logs.map(l=>'<div class="log-entry"><span class="log-time">'+l.time+'</span>'+l.message+'</div>').join('');}
function search(){const q=document.getElementById('searchInput').value;if(!q)return;
fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(rs=>{
const c=document.getElementById('searchResults');
c.innerHTML=rs.length===0?'<p style="color:#aaa">未找到</p>':rs.map(r=>'<div class="search-result"><strong>[L'+r.node.level+']</strong> '+esc(r.node.content)+'<br/><small>'+r.node.tokenCount+' tokens | '+r.score.combined.toFixed(2)+'</small></div>').join('');});}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
loadData();setInterval(loadData,5000);
</script></body></html>`;

let db: any = null;
let dag: any = null;
let traceData: any[] = [];
let logs: any[] = [];

function addLog(msg: string) {
  logs.unshift({ time: new Date().toLocaleTimeString(), message: msg });
  if (logs.length > 50) logs.pop();
}

function initDB() {
  try {
    if (!existsSync(DB_PATH)) { addLog("数据库不存在"); return false; }
    const cfg = { database: { path: DB_PATH, enableFTS5: false, enableVectors: false } };
    db = new MemoryDatabase(cfg);
    const r = db.initialize();
    if (r.success) { dag = new DAGManager(db, cfg); addLog("数据库初始化成功"); return true; }
    addLog("初始化失败：" + r.error);
  } catch (e: any) { addLog("错误：" + e.message); }
  return false;
}

function handleApi(url: string, res: ServerResponse) {
  const u = new URL(url, 'http://localhost:' + PORT);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (u.pathname === '/api/data') {
    res.end(JSON.stringify({
      stats: db?.getStats() || { nodeCount: 0, maxLevel: 0, totalTokens: 0, sessionCount: 0 },
      nodes: dag?.getSessionNodes() || [],
      trace: traceData,
      logs,
    }));
  } else if (u.pathname === '/api/search') {
    res.end(JSON.stringify(db?.search({ query: u.searchParams.get('q') || '', limit: 10 }) || []));
  } else if (u.pathname === '/api/stats') {
    res.end(JSON.stringify(db?.getStats() || {}));
  } else { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); }
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if ((req.url || '/').startsWith('/api/')) { handleApi(req.url || '/', res); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(HTML);
});

function checkPID() {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8'));
    try { process.kill(pid, 0); console.log("已有服务运行 PID:", pid); process.exit(0); }
    catch { unlinkSync(PID_FILE); }
  }
  writeFileSync(PID_FILE, process.pid.toString());
  addLog("服务启动 PID: " + process.pid);
  process.on('exit', () => { try { unlinkSync(PID_FILE); } catch {} });
  process.on('SIGINT', () => { addLog("关闭"); process.exit(0); });
}

function watchTrace() {
  setInterval(() => {
    try {
      if (existsSync(TRACE_FILE)) {
        const c = readFileSync(TRACE_FILE, 'utf-8');
        traceData = c.trim().split('\n').filter(l => l).map(l => JSON.parse(l)).slice(-20);
      }
    } catch {}
  }, 2000);
}

async function start() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║  Lossless Memory Web Dashboard                 ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  checkPID();
  initDB();
  watchTrace();
  server.listen(PORT, () => {
    addLog("HTTP 服务启动：" + PORT);
    console.log("\n🌐 http://localhost:" + PORT);
    console.log("📊 API: http://localhost:" + PORT + "/api/data");
    console.log("\nCtrl+C 停止\n");
  });
}

start();
