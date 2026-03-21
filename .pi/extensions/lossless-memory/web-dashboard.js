#!/usr/bin/env node
/**
 * Lossless Memory - Web Dashboard v4.1 (修复展开消息)
 */

import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 17338;
const PID_FILE = join(homedir(), ".pi/agent/lossless-memory-web.pid");
const DB_PATH = join(homedir(), ".pi/agent/lossless-memory.db");
const TRACE_FILE = "/tmp/lossless-context-trace.jsonl";
const SESSIONS_DIR = join(homedir(), ".pi/agent/sessions");

const HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Lossless Memory - 可交互 Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,monospace;background:#0f0f1a;color:#eee;padding:20px}
.header{text-align:center;padding:20px;margin-bottom:20px;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:15px;box-shadow:0 4px 20px rgba(0,217,255,0.2)}
.header h1{color:#00d9ff;margin-bottom:10px;text-shadow:0 0 20px rgba(0,217,255,0.5)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px}
.stat-card{background:linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.05));padding:15px;border-radius:12px;text-align:center;border:1px solid rgba(0,217,255,0.3)}
.stat-value{font-size:1.8em;font-weight:bold;color:#00d9ff}.stat-label{color:#aaa;margin-top:5px;font-size:0.8em}
.main-layout{display:grid;grid-template-columns:1fr 450px;gap:20px;margin-bottom:20px}
.viz-container{background:linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02));padding:20px;border-radius:15px;border:1px solid rgba(0,217,255,0.2)}
#dagCanvas{width:100%;height:450px;background:rgba(0,0,0,0.3);border-radius:10px;cursor:grab}
#dagCanvas:active{cursor:grabbing}
.detail-panel{background:linear-gradient(135deg,rgba(102,126,234,0.15),rgba(118,75,162,0.15));padding:20px;border-radius:15px;border:1px solid rgba(102,126,234,0.3);position:sticky;top:20px;max-height:88vh;overflow-y:auto}
.detail-title{font-size:1.3em;color:#00d9ff;margin-bottom:15px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1)}
.detail-content{line-height:1.8;font-size:0.95em}
.detail-meta{margin-top:20px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.1)}
.detail-item{display:flex;justify-content:space-between;margin:8px 0;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px}
.detail-label{color:#aaa}.detail-value{color:#00d9ff;font-weight:bold}
.no-selection{text-align:center;color:#666;padding:60px 20px}
.section-title{color:#00d9ff;margin:20px 0 15px;font-size:1.3em}
.project-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px;margin-bottom:20px}
.project-card{background:linear-gradient(135deg,rgba(102,126,234,0.2),rgba(118,75,162,0.2));padding:15px;border-radius:10px;border-left:4px solid #00d9ff;cursor:pointer;transition:all 0.3s}
.project-card:hover{transform:translateY(-3px);box-shadow:0 5px 20px rgba(102,126,234,0.3)}
.trace-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.trace-item{background:linear-gradient(135deg,rgba(0,217,255,0.1),rgba(0,217,255,0.05));padding:12px;border-radius:8px;border-left:3px solid #00d9ff}
.search-box{display:flex;gap:10px;margin-bottom:20px}
.search-box input{flex:1;padding:12px 20px;background:rgba(255,255,255,0.1);border:1px solid rgba(0,217,255,0.3);border-radius:10px;color:#eee}
.search-box button{padding:12px 30px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:10px;color:white;cursor:pointer;font-weight:bold}
.search-results{display:grid;gap:12px;margin-bottom:20px}
.search-result{background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;cursor:pointer;transition:all 0.3s}
.search-result:hover{background:rgba(102,126,234,0.2)}
.log-container{background:rgba(0,0,0,0.4);padding:15px;border-radius:10px;max-height:180px;overflow-y:auto}
.log-entry{padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:10px}
.log-time{color:#00d9ff;white-space:nowrap}
.refresh-btn{position:fixed;top:20px;right:20px;padding:12px 25px;background:linear-gradient(135deg,#11998e,#38ef7d);border:none;border-radius:10px;color:white;cursor:pointer;font-weight:bold;z-index:1000}
.tab-container{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.tab-btn{padding:10px 25px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#aaa;cursor:pointer}
.tab-btn.active{background:linear-gradient(135deg,#667eea,#764ba2);color:white}
.tab-content{display:none}.tab-content.active{display:block}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.no-data{text-align:center;color:#666;padding:60px;background:rgba(0,0,0,0.2);border-radius:15px}
.legend{display:flex;gap:20px;justify-content:center;margin-top:15px;font-size:0.85em;flex-wrap:wrap}
.legend-item{display:flex;align-items:center;gap:8px}
.legend-color{width:20px;height:20px;border-radius:5px}
.node-tooltip{position:absolute;background:rgba(0,0,0,0.95);padding:15px;border-radius:10px;border:1px solid rgba(0,217,255,0.5);pointer-events:none;z-index:1000;max-width:300px;box-shadow:0 4px 20px rgba(0,217,255,0.3)}
.messages-list{margin-top:15px;background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;max-height:300px;overflow-y:auto}
.message-item{padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85em}
.message-item:last-child{border-bottom:none}
.message-role{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.8em;margin-right:8px}
.message-role.user{background:rgba(79,172,254,0.3);color:#4facfe}
.message-role.assistant{background:rgba(102,126,234,0.3);color:#667eea}
</style></head><body>
<button class="refresh-btn" onclick="loadData()">🔄 刷新</button>
<div class="header"><h1>🧠 Lossless Memory Dashboard</h1><p style="color:#aaa">可交互 DAG 可视化</p></div>
<div class="stats-grid">
<div class="stat-card"><div class="stat-value" id="totalNodes">0</div><div class="stat-label">📦 节点</div></div>
<div class="stat-card"><div class="stat-value" id="maxLevel">L0</div><div class="stat-label">📊 层级</div></div>
<div class="stat-card"><div class="stat-value" id="totalTokens">0</div><div class="stat-label">📝 Token</div></div>
<div class="stat-card"><div class="stat-value" id="projectCount">0</div><div class="stat-label">📁 项目</div></div>
<div class="stat-card"><div class="stat-value" id="sessionCount">0</div><div class="stat-label">💬 会话</div></div>
<div class="stat-card"><div class="stat-value" id="traceCount">0</div><div class="stat-label">📈 跟踪</div></div>
</div>
<div class="tab-container">
<button class="tab-btn active" onclick="switchTab('viz')">🎨 可视化</button>
<button class="tab-btn" onclick="switchTab('dag')">🌳 列表</button>
<button class="tab-btn" onclick="switchTab('projects')">📁 项目</button>
<button class="tab-btn" onclick="switchTab('trace')">📊 跟踪</button>
<button class="tab-btn" onclick="switchTab('search')">🔍 搜索</button>
</div>
<div id="tab-viz" class="tab-content active">
<div class="main-layout">
<div class="viz-container">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
<h3 style="color:#00d9ff;margin:0">🎨 DAG 图谱</h3>
<div style="font-size:0.85em;color:#aaa">💡 点击节点查看详情</div>
</div>
<canvas id="dagCanvas"></canvas>
<div class="legend">
<div class="legend-item"><div class="legend-color" style="background:#4facfe"></div><span>L2 高层摘要</span></div>
<div class="legend-item"><div class="legend-color" style="background:#f5576c"></div><span>L1 基础摘要</span></div>
<div class="legend-item"><div class="legend-color" style="background:#434343"></div><span>L0 原始消息</span></div>
</div>
</div>
<div class="detail-panel" id="detailPanel">
<div class="no-selection">
<div style="font-size:3em;margin-bottom:20px">👆</div>
<div style="color:#aaa;line-height:1.8">点击 DAG 节点<br/>查看详细信息</div>
</div>
</div>
</div>
</div>
<div id="tab-dag" class="tab-content"><div class="section-title">DAG 节点列表</div><div id="dagList"></div></div>
<div id="tab-projects" class="tab-content"><div class="section-title">项目列表</div><div class="project-list" id="projectList"></div></div>
<div id="tab-trace" class="tab-content"><div class="section-title">实时跟踪</div><div class="trace-grid" id="traceList"></div></div>
<div id="tab-search" class="tab-content"><div class="section-title">搜索</div><div class="search-box"><input id="searchInput" placeholder="输入关键词..."/><button onclick="search()">搜索</button></div><div class="search-results" id="searchResults"></div></div>
<div class="section-title">系统日志</div><div class="log-container" id="logContainer"></div>
<div id="tooltip" class="node-tooltip" style="display:none"></div>
<script>
let cachedData=null,nodes=[],nodePositions=[],selectedNode=null;
function switchTab(n){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));event.target.classList.add('active');document.getElementById('tab-'+n).classList.add('active');if(n==='viz')setTimeout(renderDAG,100);}
async function loadData(){try{const r=await fetch('/api/data');const d=await r.json();cachedData=d;
document.getElementById('totalNodes').textContent=d.stats.nodeCount||0;
document.getElementById('maxLevel').textContent='L'+(d.stats.maxLevel||0);
document.getElementById('totalTokens').textContent=d.stats.totalTokens||0;
document.getElementById('projectCount').textContent=d.projects.length||0;
document.getElementById('sessionCount').textContent=d.stats.sessionCount||0;
document.getElementById('traceCount').textContent=(d.trace||[]).length;
nodes=d.nodes||[];updateDAGList(nodes);updateProjects(d.projects||[]);updateTrace(d.trace||[]);updateLogs(d.logs||[]);
if(document.getElementById('tab-viz').classList.contains('active'))renderDAG();
}catch(e){console.error('加载失败:',e);}}
function updateDAGList(nodes){const c=document.getElementById('dagList');if(!nodes||nodes.length===0){c.innerHTML='<div class="no-data">暂无节点</div>';return;}
let h='<div class="project-list">';nodes.forEach(n=>{h+='<div class="project-card" onclick="selectNode(\\''+n.id+'\\')"><div class="project-name">📌 L'+n.level+' | '+n.id.slice(0,15)+'...</div><div class="project-stats">💬 '+n.content.slice(0,80)+'...<br/>📝 '+n.tokenCount+'t | 🔗 '+n.childIds.length+'子 | 📨 '+n.sessionEntryIds.length+'消息</div></div>';});
h+='</div>';c.innerHTML=h;}
function selectNode(id){const node=nodes.find(n=>n.id===id);if(!node)return;selectedNode=node;
const levelStats=nodes.reduce((acc,n)=>{acc[n.level]=(acc[n.level]||0)+1;return acc;},{});
const entryCount=node.sessionEntryIds?node.sessionEntryIds.length:0;
const entryPreview=node.sessionEntryIds?node.sessionEntryIds.slice(0,20):[];
document.getElementById('detailPanel').innerHTML='<div class="detail-title">📌 L'+node.level+' 节点详情</div>'+
'<div class="detail-content"><div style="color:#aaa;margin-bottom:10px">ID: <span style="color:#00d9ff;font-family:monospace">'+node.id+'</span></div>'+
'<div style="background:rgba(0,0,0,0.3);padding:15px;border-radius:8px;margin-bottom:15px;line-height:1.8;font-size:0.95em">'+node.content+'</div></div>'+
'<div class="level-stats"><div class="level-card"><h4>L2</h4><div class="count" style="color:#4facfe">'+(levelStats[2]||0)+'</div></div>'+
'<div class="level-card"><h4>L1</h4><div class="count" style="color:#f5576c">'+(levelStats[1]||0)+'</div></div>'+
'<div class="level-card"><h4>L0</h4><div class="count" style="color:#666">'+(levelStats[0]||0)+'</div></div></div>'+
'<div class="detail-meta">'+
'<div class="detail-item"><span class="detail-label">📝 Token</span><span class="detail-value">'+node.tokenCount+'</span></div>'+
'<div class="detail-item"><span class="detail-label">🔗 子节点</span><span class="detail-value">'+(node.childIds?node.childIds.length:0)+'</span></div>'+
'<div class="detail-item"><span class="detail-label">📨 消息</span><span class="detail-value">'+entryCount+'</span></div>'+
'<div class="detail-item"><span class="detail-label">📁 层级</span><span class="detail-value">L'+node.level+'</span></div>'+
'</div>'+
'<div style="margin-top:20px;display:flex;gap:10px">'+
'<button onclick="showChildren(\\''+node.id+'\\')" style="flex:1;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:8px;color:white;cursor:pointer;font-weight:bold">🔗 查看子节点</button>'+
'<button onclick="showMessages(\\''+node.id+'\\')" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#eee;cursor:pointer;font-weight:bold">📂 展开 '+entryCount+' 条消息</button>'+
'</div>'+(entryCount>0?'<div class="messages-list"><div style="color:#aaa;margin-bottom:10px;font-size:0.9em">📨 关联消息预览 (前 20 条)</div>'+entryPreview.map((eid,i)=>'<div class="message-item"><span class="message-role '+(i%2===0?'user':'assistant')+'">'+(i%2===0?'User':'Asst')+'</span><span style="color:#aaa;font-family:monospace">'+eid+'</span></div>').join('')+(entryCount>20?'<div style="color:#666;text-align:center;margin-top:10px;font-size:0.85em">... 还有 '+(entryCount-20)+' 条</div>':'')+'</div>':'')}
function showChildren(id){const node=nodes.find(n=>n.id===id);if(!node||!node.childIds){alert('没有子节点');return;}const children=nodes.filter(n=>node.childIds.includes(n.id));if(children.length===0){alert('子节点不在当前数据中');return;}let msg='子节点 ('+children.length+'个):\\n\\n';children.forEach(c=>{msg+='• L'+c.level+': '+c.content.slice(0,60)+'...\\n';});alert(msg);}
function showMessages(id){const node=nodes.find(n=>n.id===id);if(!node||!node.sessionEntryIds){alert('没有关联消息');return;}
const count=node.sessionEntryIds.length;
const preview=node.sessionEntryIds.slice(0,30).join('\\n');
alert('关联消息 ('+count+'条):\\n\\n'+preview+(count>30?'\\n\\n... 还有 '+(count-30)+' 条':''));}
function updateProjects(list){const c=document.getElementById('projectList');if(!list||list.length===0){c.innerHTML='<div class="no-data">暂无项目</div>';return;}c.innerHTML=list.map(p=>'<div class="project-card"><div class="project-name">📁 '+esc(p.name)+'</div><div class="project-stats">📊 '+p.sessions+'会话<br/>📦 '+p.nodes+'节点<br/>📝 '+p.tokens+' tokens</div></div>').join('');}
function updateTrace(t){const c=document.getElementById('traceList');if(!t||t.length===0){c.innerHTML='<div class="no-data">暂无记录</div>';return;}c.innerHTML=t.map(x=>'<div class="trace-item"><strong>⏱️ 第'+x.turn+'轮</strong><br/><span style="color:#aaa">📨 '+x.messages+'条</span> | <span style="color:#00d9ff">📝 '+x.totalTokens+'t</span></div>').join('');}
function updateLogs(l){const c=document.getElementById('logContainer');if(!l||l.length===0){c.innerHTML='<div class="no-data">暂无日志</div>';return;}c.innerHTML=l.map(x=>'<div class="log-entry"><span class="log-time">🕐 '+x.time+'</span><span>'+x.message+'</span></div>').join('');}
function search(){const q=document.getElementById('searchInput').value;if(!q)return;fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(rs=>{const c=document.getElementById('searchResults');c.innerHTML=rs.length===0?'<div class="no-data">未找到</div>':rs.map(r=>'<div class="search-result" onclick="selectNode(\\''+r.node.id+'\\");switchTab(\\'viz\\')"><strong>[L'+r.node.level+']</strong> '+esc(r.node.content.slice(0,120))+'...<br/><small style="color:#aaa;margin-top:8px;display:block">📝 '+r.node.token_count+'t</small></div>').join('');});}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function renderDAG(){const canvas=document.getElementById('dagCanvas');if(!canvas)return;const ctx=canvas.getContext('2d');const dpr=window.devicePixelRatio||1;const rect=canvas.getBoundingClientRect();canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,rect.width,rect.height);ctx.fillStyle='#0f0f1a';ctx.fillRect(0,0,rect.width,rect.height);
if(!nodes||nodes.length===0){ctx.fillStyle='#666';ctx.font='16px monospace';ctx.textAlign='center';ctx.fillText('暂无 DAG 节点',rect.width/2,rect.height/2);return;}
const levels={};nodes.forEach(n=>{if(!levels[n.level])levels[n.level]=[];levels[n.level].push(n);});const levelKeys=Object.keys(levels).sort((a,b)=>b-a);
const nodeRadius=75,levelHeight=120,marginTop=80;nodePositions=[];
levelKeys.forEach((l,li)=>{const nodesInLevel=levels[l];const totalWidth=nodesInLevel.length*(nodeRadius*2+40)-40;const startX=(rect.width-totalWidth)/2;nodesInLevel.forEach((n,i)=>{const x=startX+i*(nodeRadius*2+40);const y=marginTop+li*levelHeight;nodePositions.push({id:n.id,x,y,level:l,radius:nodeRadius,data:n});});});
ctx.strokeStyle='rgba(102,126,234,0.4)';ctx.lineWidth=2;ctx.setLineDash([5,5]);nodePositions.forEach(np=>{const node=np.data;if(node.childIds&&node.childIds.length>0){node.childIds.forEach(cid=>{const child=nodePositions.find(p=>p.id===cid);if(child){ctx.beginPath();ctx.moveTo(np.x,np.y+np.radius);ctx.lineTo(child.x,child.y-child.radius);ctx.stroke();}});}});ctx.setLineDash([]);
nodePositions.forEach(np=>{const gradient=ctx.createRadialGradient(np.x,np.y,0,np.x,np.y,np.radius);let color1,color2;if(np.level==2){color1='rgba(79,172,254,0.9)';color2='rgba(0,242,254,0.7)';}else if(np.level==1){color1='rgba(240,147,251,0.9)';color2='rgba(245,87,108,0.7)';}else{color1='rgba(67,67,67,0.9)';color2='rgba(44,44,44,0.7)';}
gradient.addColorStop(0,color1);gradient.addColorStop(1,color2);ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(np.x,np.y,np.radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle=selectedNode&&selectedNode.id===np.id?'rgba(0,217,255,1)':'rgba(0,217,255,0.5)';ctx.lineWidth=selectedNode&&selectedNode.id===np.id?4:2;ctx.stroke();
ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillText('L'+np.level,np.x,np.y-30);ctx.font='10px monospace';ctx.fillStyle='rgba(255,255,255,0.8)';const id=np.id.slice(0,10)+'...';ctx.fillText(id,np.x,np.y-15);const tokens=np.data.tokenCount||0;ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='10px monospace';ctx.fillText(tokens+'t',np.x,np.y+40);const children=np.data.childIds?np.data.childIds.length:0;ctx.fillText(children+'子',np.x,np.y+53);});
canvas.onmousemove=(e)=>{const rect=canvas.getBoundingClientRect();const mx=e.clientX-rect.left;const my=e.clientY-rect.top;let hovered=null;nodePositions.forEach(np=>{const dx=mx-np.x;const dy=my-np.y;if(Math.sqrt(dx*dx+dy*dy)<np.radius){hovered=np;canvas.style.cursor='pointer';}});
if(hovered){const tooltip=document.getElementById('tooltip');tooltip.style.display='block';tooltip.style.left=(e.clientX+15)+'px';tooltip.style.top=(e.clientY+15)+'px';tooltip.innerHTML='<strong style="color:#00d9ff">L'+hovered.level+' | '+hovered.data.id.slice(0,12)+'...</strong><br/><span style="color:#aaa">'+hovered.data.content.slice(0,80)+'...</span><br/><span style="color:#aaa;margin-top:5px;display:block">📝 '+hovered.data.tokenCount+'t | 🔗 '+hovered.data.childIds.length+'子</span>';}else{document.getElementById('tooltip').style.display='none';canvas.style.cursor='default';}};
canvas.onclick=(e)=>{const rect=canvas.getBoundingClientRect();const mx=e.clientX-rect.left;const my=e.clientY-rect.top;nodePositions.forEach(np=>{const dx=mx-np.x;const dy=my-np.y;if(Math.sqrt(dx*dx+dy*dy)<np.radius){selectNode(np.id);}});};
}
loadData();setInterval(loadData,5000);window.addEventListener('resize',()=>{if(document.getElementById('tab-viz').classList.contains('active'))setTimeout(renderDAG,100);});
</script></body></html>`;

let traceData = [], logs = [];
function addLog(msg) { logs.unshift({ time: new Date().toLocaleTimeString(), message: msg }); if (logs.length > 50) logs.pop(); }

async function queryDB(sql, params = []) {
  const { DatabaseSync } = await import('node:sqlite');
  try { const db = new DatabaseSync(DB_PATH); const stmt = db.prepare(sql); const r = params.length ? stmt.all(...params) : stmt.all(); db.close(); return r; } catch { return []; }
}

async function getStats() {
  const nodes = await queryDB('SELECT * FROM memory_nodes');
  const sessions = await queryDB('SELECT COUNT(*) as count FROM session_index');
  return { nodeCount: nodes.length, maxLevel: nodes.reduce((m,n)=>Math.max(m,n.level||0),0), totalTokens: nodes.reduce((s,n)=>s+(n.token_count||0),0), sessionCount: sessions[0]?.count||0 };
}

async function getNodes() {
  const rows = await queryDB('SELECT * FROM memory_nodes ORDER BY level DESC, created_at ASC');
  return rows.map(r => ({ id:r.id, level:r.level, type:r.type, content:r.content, tokenCount:r.token_count||0, childIds:r.child_ids?JSON.parse(r.child_ids):[], sessionEntryIds:r.session_entry_ids?JSON.parse(r.session_entry_ids):[] }));
}

async function getProjects() {
  try { if (!existsSync(SESSIONS_DIR)) return []; const files = readdirSync(SESSIONS_DIR).filter(f=>f.endsWith('.jsonl')); return [{ name:'pi-mono', path:cwd(), sessions:files.length, nodes:0, tokens:500 }]; } catch { return []; }
}

async function searchDB(q) {
  const rows = await queryDB('SELECT * FROM memory_nodes WHERE content LIKE ? LIMIT 20', ['%'+q+'%']);
  return rows.map(r => ({ node:{ id:r.id, level:r.level, content:r.content, token_count:r.token_count }, score:{ combined:1.0 } }));
}

function handleApi(url, res) {
  const u = new URL(url, 'http://localhost:'+PORT);
  res.setHeader('Content-Type','application/json'); res.setHeader('Access-Control-Allow-Origin','*');
  if (u.pathname==='/api/data') Promise.all([getStats(),getNodes(),getProjects()]).then(([s,n,p])=>res.end(JSON.stringify({stats:s,nodes:n,projects:p,trace:traceData,logs})));
  else if (u.pathname==='/api/search') searchDB(u.searchParams.get('q')||'').then(r=>res.end(JSON.stringify(r)));
  else if (u.pathname==='/api/stats') getStats().then(r=>res.end(JSON.stringify(r)));
  else { res.statusCode=404; res.end(JSON.stringify({error:'Not found'})); }
}

const server = createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') { res.end(); return; }
  if ((req.url||'/').startsWith('/api/')) { handleApi(req.url||'/',res); return; }
  res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(HTML);
});

function checkPID() {
  if (existsSync(PID_FILE)) { const pid=parseInt(readFileSync(PID_FILE,'utf-8')); try { process.kill(pid,0); console.log("已有服务 PID:",pid); process.exit(0); } catch { unlinkSync(PID_FILE); } }
  writeFileSync(PID_FILE,process.pid.toString());
  process.on('exit',()=>{try{unlinkSync(PID_FILE)}catch{}}); process.on('SIGINT',()=>process.exit(0));
}

function watchTrace() { setInterval(()=>{ try { if (existsSync(TRACE_FILE)) { const c=readFileSync(TRACE_FILE,'utf-8'); traceData=c.trim().split('\n').filter(l=>l).map(l=>JSON.parse(l)).slice(-50); } } catch {} }, 2000); }

async function start() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   Lossless Memory - 可交互 Dashboard v4.1         ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  checkPID(); watchTrace();
  server.listen(PORT, ()=>{
    addLog("服务启动："+PORT);
    console.log("🌐 访问：http://localhost:"+PORT);
    console.log("✨ 功能:");
    console.log("   • 点击 DAG 节点 → 右侧显示详情");
    console.log("   • 显示 DAG 层级统计 (L2/L1/L0)");
    console.log("   • 关联消息预览 (前 20 条)");
    console.log("   • '展开消息' 按钮查看所有消息 ID\n");
  });
}

start();
