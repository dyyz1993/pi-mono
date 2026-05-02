import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import { existsSync } from "node:fs";
import { TEMPLATES, generateSettingsJson } from "./templates.js";

const PORT = 3456;
let projectDir = process.cwd();

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".nuxt",
	"coverage",
	".turbo",
	".cache",
	".DS_Store",
	"__pycache__",
	".venv",
	"vendor",
	"target",
	".tox",
	".mypy_cache",
	".pytest_cache",
]);

const SENSITIVE_PATTERNS = [
	/\.env($|\.)/i,
	/credentials/i,
	/secret/i,
	/\.pem$/i,
	/\.key$/i,
	/\.p12$/i,
	/\.pfx$/i,
	/id_rsa/i,
	/id_ed25519/i,
	/\.npmrc$/i,
	/\.pypirc$/i,
];

const ARCHITECTURE_FILES = new Set([
	"package.json",
	"tsconfig.json",
	"vite.config.ts",
	"vite.config.js",
	"next.config.ts",
	"next.config.js",
	"webpack.config.js",
	"rollup.config.js",
	"docker-compose.yml",
	"Dockerfile",
	"Makefile",
	"Cargo.toml",
	"go.mod",
	"pom.xml",
	"build.gradle",
	".eslintrc.js",
	".eslintrc.json",
	".eslintrc.cjs",
	"eslint.config.mjs",
	"prettier.config.js",
	".prettierrc",
	"tailwind.config.ts",
	"tailwind.config.js",
]);

interface FileNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: FileNode[];
	size?: number;
	isSensitive?: boolean;
	isArchitecture?: boolean;
	extension?: string;
}

async function scanDirectory(dir: string, maxDepth: number = 3, depth: number = 0): Promise<FileNode> {
	const name = basename(dir);
	const node: FileNode = { name, path: dir, type: "directory", children: [] };

	if (depth >= maxDepth) return node;

	try {
		const entries = await readdir(dir, { withFileTypes: true });
		const sorted = entries.sort((a, b) => {
			if (a.isDirectory() && !b.isDirectory()) return -1;
			if (!a.isDirectory() && b.isDirectory()) return 1;
			return a.name.localeCompare(b.name);
		});

		for (const entry of sorted) {
			if (IGNORED_DIRS.has(entry.name)) continue;
			if (entry.name.startsWith(".") && depth > 0 && entry.name !== ".claude") continue;

			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				const child = await scanDirectory(fullPath, maxDepth, depth + 1);
				node.children!.push(child);
			} else {
				const isSensitive = SENSITIVE_PATTERNS.some((p) => p.test(entry.name));
				const isArchitecture = ARCHITECTURE_FILES.has(entry.name);
				node.children!.push({
					name: entry.name,
					path: fullPath,
					type: "file",
					extension: extname(entry.name),
					isSensitive,
					isArchitecture,
				});
			}
		}
	} catch {}

	return node;
}

function renderTreeHtml(node: FileNode, depth: number, basePath: string): string {
	if (depth > 5) return "";
	if (node.type === "file") {
		const relPath = node.path.replace(basePath + "/", "");
		const sDot = node.isSensitive ? '<span class="w-2 h-2 rounded-full bg-red-500 inline-block"></span>' : "";
		const aDot = node.isArchitecture
			? '<span class="w-2 h-2 rounded-full bg-amber-500 inline-block ml-1"></span>'
			: "";
		return `<div class="file-item flex items-center gap-1.5 py-0.5 px-2 rounded" style="padding-left:${depth * 16 + 8}px" draggable="true" data-rel="${relPath}" data-name="${node.name}" ondragstart="handleDragStart(event)"><span class="text-sm">&#128196;</span><span class="truncate">${node.name}</span>${sDot}${aDot}</div>`;
	}
	const childrenHtml = node.children
		? node.children.map((c) => renderTreeHtml(c, depth + 1, basePath)).join("")
		: "";
	return `<div><div class="tree-toggle flex items-center gap-1.5 py-0.5 px-2 rounded" style="padding-left:${depth * 16 + 8}px" draggable="true" data-rel="${node.path.replace(basePath + "/", "")}/" data-name="${node.name}" ondragstart="handleDragStart(event)" onclick="toggleDir(this)"><span class="text-gray-400 text-xs transition-transform">&#9654;</span><span class="text-gray-600 text-sm">&#128193; ${node.name}</span></div><div class="tree-children">${childrenHtml}</div></div>`;
}

function collectFilePaths(node: FileNode, basePath: string, out: string[]): void {
	if (node.type === "file") {
		out.push(node.path.replace(basePath + "/", ""));
		return;
	}
	if (node.children) {
		for (const c of node.children) collectFilePaths(c, basePath, out);
	}
}

function matchIfClause(ifClause: string | undefined, filePath: string): boolean {
	if (!ifClause) return false;
	const m = ifClause.match(/^\w+\((.+)\)$/);
	if (!m) return false;
	const pattern = m[1];
	const regex = globToRegex(pattern);
	try {
		return new RegExp(regex, "i").test(filePath);
	} catch {
		return false;
	}
}

function globToRegex(pattern: string): string {
	return pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
}

let cachedTree: FileNode | null = null;
let cachedPaths: string[] = [];

async function getTreeAndPaths(): Promise<{ tree: FileNode; paths: string[] }> {
	if (!cachedTree) {
		cachedTree = await scanDirectory(projectDir);
		cachedPaths = [];
		collectFilePaths(cachedTree, projectDir, cachedPaths);
	}
	return { tree: cachedTree, paths: cachedPaths };
}

function html(): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hooks Configurator</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  .tree-toggle{cursor:pointer;user-select:none}
  .tree-toggle:hover{background:rgba(99,102,241,.06);border-radius:4px}
  .tree-children{display:none}
  .tree-children.open{display:block}
  .template-card{transition:all .15s}
  .template-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
  .template-card.drag-over{border-color:#6366f1!important;box-shadow:0 0 0 2px rgba(99,102,241,.2)}
  .preview-json{font-family:'SF Mono','Fira Code',monospace;font-size:12px;line-height:1.5}
  #toast{position:fixed;top:20px;right:20px;z-index:9999}
  .file-item[draggable=true]{cursor:grab}
  .file-item[draggable=true]:active{cursor:grabbing;opacity:.6}
  .ext-ts,.ext-tsx{color:#3178c6}.ext-js,.ext-jsx{color:#f7df1e}.ext-json{color:#43a047}
  .ext-css,.ext-scss{color:#a855f7}.ext-md{color:#64748b}.ext-env{color:#ef4444}
</style>
</head>
<body class="bg-gray-50 min-h-screen">
<div id="toast"></div>
<div class="max-w-7xl mx-auto px-4 py-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Claude Hooks Configurator</h1>
      <p id="project-path" class="text-sm text-gray-400 mt-1"></p>
    </div>
    <div class="flex gap-3">
      <button onclick="loadProject()" class="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">&#128260; 刷新</button>
      <button onclick="applyConfig()" class="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">&#128190; 应用配置</button>
    </div>
  </div>

  <div class="grid grid-cols-12 gap-6">
    <!-- Left: File Tree + Drop Zones -->
    <div class="col-span-3">
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 class="font-semibold text-sm text-gray-700">&#128193; 文件树</h2>
          <span class="text-xs text-gray-400">拖拽文件到右侧卡片</span>
        </div>
        <div id="file-tree" class="p-2 max-h-[45vh] overflow-y-auto text-sm">
          <div class="text-gray-400 text-center py-8">加载中...</div>
        </div>
      </div>


    </div>

    <!-- Center: Active Rules + Templates -->
    <div class="col-span-5 flex flex-col gap-4">
      <!-- Active Rules -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 class="font-semibold text-sm text-gray-700">&#128220; 当前生效规则 <span id="rule-count" class="text-xs text-gray-400"></span></h2>
          <button onclick="loadActiveRules()" class="text-xs text-indigo-600 hover:text-indigo-800">&#128260; 刷新</button>
        </div>
        <div id="active-rules" class="p-3 space-y-2 max-h-[35vh] overflow-y-auto">
          <div class="text-gray-400 text-center py-4 text-sm">加载中...</div>
        </div>
      </div>

      <!-- Template Library -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1">
        <div class="px-4 py-3 border-b border-gray-100">
          <h2 class="font-semibold text-sm text-gray-700">&#10133; 模板库（快速添加）</h2>
        </div>
        <div class="flex border-b border-gray-100">
          <button onclick="filterCategory('all')" class="cat-btn px-3 py-2 text-xs font-medium text-indigo-600 border-b-2 border-indigo-600" data-cat="all">全部</button>
          <button onclick="filterCategory('command-filter')" class="cat-btn px-3 py-2 text-xs font-medium text-gray-500" data-cat="command-filter">命令</button>
          <button onclick="filterCategory('file-protection')" class="cat-btn px-3 py-2 text-xs font-medium text-gray-500" data-cat="file-protection">文件</button>
          <button onclick="filterCategory('sensitive')" class="cat-btn px-3 py-2 text-xs font-medium text-gray-500" data-cat="sensitive">敏感</button>
          <button onclick="filterCategory('redirect')" class="cat-btn px-3 py-2 text-xs font-medium text-gray-500" data-cat="redirect">引导</button>
        </div>
        <div id="templates" class="p-3 space-y-2 max-h-[35vh] overflow-y-auto"></div>
      </div>
    </div>

    <!-- Right: Preview -->
    <div class="col-span-4">
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden sticky top-6">
        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 class="font-semibold text-sm text-gray-700">预览 settings.json</h2>
          <button onclick="copyConfig()" class="text-xs text-indigo-600 hover:text-indigo-800">&#128203; 复制</button>
        </div>
        <div class="p-4 max-h-[calc(100vh-200px)] overflow-auto">
          <pre id="preview" class="preview-json text-gray-700 whitespace-pre-wrap">{}</pre>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
const API='';
let templates=[], currentCategory='all', projectPath='';
let cardStates=new Map();
let fileMatches={};
let highlightedId=null;

const CAT_ICONS={'command-filter':'&#9888;','file-protection':'&#128274;','role-restriction':'&#128101;','sensitive':'&#128272;','keyword-route':'&#128270;','redirect':'&#128279;'};
const CAT_LABELS={'command-filter':'命令过滤','file-protection':'文件保护','role-restriction':'角色限制','sensitive':'敏感信息','keyword-route':'路由','redirect':'引导重定向'};
const ACTION_LABELS={ask:'&#9888; 需确认',block:'&#128683; 拦截'};

async function loadTemplates(){
  templates=await(await fetch(API+'/api/templates')).json();
  const ids=templates.map(t=>t.id);
  fileMatches=await(await fetch(API+'/api/match-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateIds:ids})})).json();
  renderTemplates();
}

function getState(id){return cardStates.get(id)||{enabled:false,files:[],action:'ask'}}
function setState(id,patch){cardStates.set(id,{...getState(id),...patch})}

function renderTemplates(){
  const c=document.getElementById('templates');
  const f=currentCategory==='all'?templates:templates.filter(t=>t.category===currentCategory);
  c.innerHTML=f.map(t=>{
    const s=getState(t.id);
    const icon=CAT_ICONS[t.category]||'&#9881;';
    const cat=CAT_LABELS[t.category]||t.category;
    const mf=fileMatches[t.id]||[];
    const dropAttrs=t.acceptsFiles?' ondrop="dropOnCard(event,\\''+t.id+'\\')" ondragover="event.preventDefault();this.classList.add(\\'drag-over\\')" ondragleave="this.classList.remove(\\'drag-over\\')"':'';
    const fileTags=s.files.map(p=>'<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">'+p+'<button onclick="event.stopPropagation();removeCardFile(\\''+t.id+'\\',\\''+p+'\\')" class="hover:text-red-600">&times;</button></span>').join('');
    const actionSel=t.acceptsFiles?'<select onchange="setCardAction(\\''+t.id+'\\',this.value)" class="text-xs border rounded px-1 py-0.5 '+(s.action==='block'?'border-red-300 text-red-700 bg-red-50':'border-amber-300 text-amber-700 bg-amber-50')+'" onclick="event.stopPropagation()">'
      +'<option value="ask"'+(s.action==='ask'?' selected':'')+'>&#9888; 需确认</option>'
      +'<option value="block"'+(s.action==='block'?' selected':'')+'>&#128683; 拦截</option></select>':'';
    return '<div class="template-card border rounded-lg p-3 cursor-pointer '+(s.enabled?'border-indigo-400 bg-indigo-50/50':'border-gray-200 bg-white')+'" onclick="toggleCard(\\''+t.id+'\\')"'+dropAttrs+'>'
      +'<div class="flex items-center gap-2">'
      +'<div class="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 '+(s.enabled?'bg-indigo-600 border-indigo-600':'border-gray-300')+'">'
      +(s.enabled?'<svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>':'')
      +'</div>'
      +'<span class="text-lg">'+icon+'</span>'
      +'<div class="flex-1 min-w-0">'
      +'<div class="flex items-center gap-1.5 flex-wrap">'
      +'<span class="font-medium text-sm text-gray-900">'+t.name+'</span>'
      +'<span class="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">'+cat+'</span>'
      +(!t.acceptsFiles?'<span class="text-xs px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600">&#127760; 全局</span>':'')
      +'</div>'
      +'<p class="text-xs text-gray-500 mt-0.5 truncate">'+t.description+'</p>'
      +'</div>'
      +actionSel
      +'</div>'
      +(t.acceptsFiles?'<div class="mt-2 flex flex-wrap gap-1 min-h-[24px]">'
      +fileTags
      +(s.files.length===0?'<span class="text-xs text-gray-400">拖入文件到此卡片</span>':'')
      +'</div>':'')
      +'</div>';
  }).join('');
}

function toggleCard(id){const s=getState(id);setState(id,{enabled:!s.enabled});renderTemplates();updatePreview()}

function setCardAction(id,action){setState(id,{action});renderTemplates();updatePreview()}

function removeCardFile(id,path){
  const s=getState(id);
  setState(id,{files:s.files.filter(f=>f!==path)});
  renderTemplates();updatePreview();
}

function dropOnCard(e,id){
  e.preventDefault();e.stopPropagation();
  const path=e.dataTransfer.getData('text/plain');
  if(!path)return;
  const s=getState(id);
  if(!s.files.includes(path)){setState(id,{files:[...s.files,path]});renderTemplates();updatePreview()}
}

function filterCategory(cat){
  currentCategory=cat;
  document.querySelectorAll('.cat-btn').forEach(b=>{
    b.className='cat-btn px-3 py-2 text-xs font-medium '+(b.dataset.cat===cat?'text-indigo-600 border-b-2 border-indigo-600':'text-gray-500 hover:text-gray-700');
  });renderTemplates();
}

async function loadProject(){
  const data=await(await fetch(API+'/api/scan')).json();
  projectPath=data.path;
  document.getElementById('project-path').textContent=projectPath;
  document.getElementById('file-tree').innerHTML=data.html;
}

function toggleDir(el){
  const ch=el.nextElementSibling;ch.classList.toggle('open');
  el.querySelector('span').style.transform=ch.classList.contains('open')?'rotate(90deg)':'';
}

function handleDragStart(e){
  e.dataTransfer.setData('text/plain',e.target.dataset.rel);
  e.dataTransfer.setData('application/x-name',e.target.dataset.name);
  e.dataTransfer.effectAllowed='copy';
}

function getEntriesForApi(){
  const entries=[];
  cardStates.forEach((s,id)=>{
    if(s.enabled)entries.push({templateId:id,files:s.files,action:s.action});
  });
  return entries;
}

async function updatePreview(){
  const entries=getEntriesForApi();
  const data=await(await fetch(API+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entries)})).json();
  document.getElementById('preview').textContent=JSON.stringify(data.config,null,2);
}

async function applyConfig(){
  const entries=getEntriesForApi();
  const data=await(await fetch(API+'/api/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entries)})).json();
  showToast(data.success?'success':'error',data.success?'配置已写入 '+data.path:(data.error||'写入失败'));
  if(data.success)loadActiveRules();
}

function copyConfig(){navigator.clipboard.writeText(document.getElementById('preview').textContent).then(()=>showToast('success','已复制到剪贴板'))}

function showToast(type,msg){
  const el=document.getElementById('toast');
  el.innerHTML='<div class="'+(type==='success'?'bg-green-600':'bg-red-600')+' text-white px-4 py-2 rounded-lg shadow-lg text-sm">'+msg+'</div>';
  setTimeout(()=>{el.innerHTML=''},3000);
}

const ACTION_BADGE={'block':'<span class="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">&#128683; 拦截</span>','ask':'<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">&#9888; 需确认</span>','deny':'<span class="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">&#128683; 拒绝</span>','prompt':'<span class="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">&#128172; LLM</span>','allow':'<span class="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">&#10003; 放行</span>'};

async function loadActiveRules(){
  const data=await(await fetch(API+'/api/parse-config')).json();
  const rules=data.rules||[];
  const c=document.getElementById('active-rules');
  document.getElementById('rule-count').textContent=rules.length>0?'('+rules.length+'条)':'';
  if(rules.length===0){
    c.innerHTML='<div class="text-gray-400 text-center py-4 text-sm">暂无生效规则 — 从下方模板库添加</div>';
    return;
  }
  c.innerHTML=rules.map((r,i)=>{
    const badge=ACTION_BADGE[r.action]||ACTION_BADGE['allow'];
    const ifTag=r['if']?'<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 truncate max-w-[120px] inline-block align-bottom" title="'+r['if']+'">'+r['if']+'</span>':'';
    return '<div class="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-gray-300 transition-colors">'
      +'<span class="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 shrink-0">'+r.event+'</span>'
      +'<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">'+r.matcher+'</span>'
      +ifTag+badge
      +'<span class="text-xs text-gray-500 flex-1 truncate">'+r.description+'</span>'
      +'<button onclick="removeRule('+i+')" class="text-gray-400 hover:text-red-600 text-sm shrink-0">&times;</button>'
      +'</div>';
  }).join('');
}

async function removeRule(idx){
  const data=await(await fetch(API+'/api/parse-config')).json();
  const rules=data.rules||[];
  const r=rules[idx];
  if(!r)return;
  await fetch(API+'/api/remove-rule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:r.event,matcher:r.matcher,ifClause:r['if']})});
  loadActiveRules();updatePreview();showToast('success','已删除规则');
}

async function init(){
  await Promise.all([loadTemplates(),loadProject()]);
  const data=await(await fetch(API+'/api/parse-config')).json();
  const cards=data.cards||[];
  for(const card of cards){
    cardStates.set(card.templateId,{enabled:true,files:card.files||[],action:card.action||'ask'});
  }
  for(const tpl of templates){
    if(!cardStates.has(tpl.id)){
      cardStates.set(tpl.id,{enabled:false,files:[],action:tpl.defaultAction||'ask'});
    }
  }
  renderTemplates();loadActiveRules();updatePreview();
}

init();
</script>
</body></html>`;
}

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/") {
			return new Response(html(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
		}

		if (url.pathname === "/api/scan") {
			cachedTree = null;
			const { tree, paths } = await getTreeAndPaths();
			const html = renderTreeHtml(tree, 0, projectDir);
			return Response.json({ tree, path: projectDir, html, totalFiles: paths.length });
		}

		if (url.pathname === "/api/match-files" && req.method === "POST") {
			const body = (await req.json()) as { templateIds: string[] };
			const { paths } = await getTreeAndPaths();
			const result: Record<string, string[]> = {};

			for (const tplId of body.templateIds ?? []) {
				const tpl = TEMPLATES.find((t) => t.id === tplId);
				if (!tpl) continue;
				const matched: string[] = [];
				for (const rule of tpl.rules) {
					if (!rule.ifClause) continue;
					for (const p of paths) {
						if (matchIfClause(rule.ifClause, p) && !matched.includes(p)) {
							matched.push(p);
						}
					}
				}
				result[tplId] = matched;
			}

			return Response.json(result);
		}

		if (url.pathname === "/api/parse-config") {
			const settingsPath = join(projectDir, ".claude", "settings.json");
			if (!existsSync(settingsPath)) return Response.json({ rules: [], cards: [] });
			try {
				const raw = JSON.parse(await readFile(settingsPath, "utf-8"));
				const hooks = raw.hooks || {};
				const allRules: Array<Record<string, string>> = [];
				const cardsMap = new Map<string, { templateId: string; files: string[]; action: string }>();

				for (const [event, groups] of Object.entries(hooks)) {
					for (const group of groups as Array<{
						matcher?: string;
						hooks: Array<Record<string, string>>;
					}>) {
						for (const h of group.hooks || []) {
							let action = "allow";
							const cmd = h.command || "";
							if (cmd.includes("exit 2")) action = "block";
							else if (cmd.includes('"permissionDecision":"deny"')) action = "deny";
							else if (cmd.includes('"permissionDecision":"ask"')) action = "ask";
							else if (h.type === "prompt") action = "prompt";

							const tplId = h["x-pi-id"] || "";
							const piFile = h["x-pi-file"] || "";
							const ifClause = h.if || "";
							const matcher = group.matcher || "全部";

							let desc = "";
							if (action === "block") desc = ifClause ? `拦截匹配 ${ifClause}` : `拦截 ${matcher}`;
							else if (action === "ask") desc = ifClause ? `修改 ${ifClause} 时需确认` : `${matcher} 需确认`;
							else if (action === "prompt") desc = "LLM 评估";
							else desc = `${matcher} 调用`;

							allRules.push({
								event,
								matcher,
								if: ifClause,
								type: h.type || "command",
								action,
								description: desc,
								command: cmd,
								prompt: h.prompt || "",
								"x-pi-id": tplId,
								"x-pi-file": piFile,
							});

							if (tplId) {
								if (!cardsMap.has(tplId)) {
									cardsMap.set(tplId, { templateId: tplId, files: [], action });
								}
								const card = cardsMap.get(tplId)!;
								if (piFile && !card.files.includes(piFile)) {
									card.files.push(piFile);
								}
								card.action = action;
							}
						}
					}
				}

				return Response.json({
					rules: allRules,
					cards: Array.from(cardsMap.values()),
				});
			} catch {
				return Response.json({ rules: [], cards: [] });
			}
		}

		if (url.pathname === "/api/remove-rule" && req.method === "POST") {
			const body = (await req.json()) as { event: string; matcher: string; ifClause: string };
			const settingsPath = join(projectDir, ".claude", "settings.json");
			if (!existsSync(settingsPath)) return Response.json({ success: false });

			const raw = JSON.parse(await readFile(settingsPath, "utf-8"));
			const hooks = raw.hooks || {};
			const event = body.event;
			if (hooks[event]) {
				for (const group of hooks[event]) {
					group.hooks = (group.hooks || []).filter(
						(h: Record<string, string>) => h.if !== body.ifClause,
					);
				}
				hooks[event] = hooks[event].filter((g: { hooks: unknown[] }) => g.hooks.length > 0);
				if (hooks[event].length === 0) delete hooks[event];
			}
			raw.hooks = hooks;
			await writeFile(settingsPath, JSON.stringify(raw, null, 2));
			return Response.json({ success: true });
		}

		if (url.pathname === "/api/load-config") {
			const settingsPath = join(projectDir, ".claude", "settings.json");
			if (!existsSync(settingsPath)) {
				return Response.json({ exists: false });
			}
			try {
				const raw = JSON.parse(await readFile(settingsPath, "utf-8"));
				return Response.json({ exists: true, config: raw });
			} catch {
				return Response.json({ exists: false });
			}
		}

		if (url.pathname === "/api/templates") {
			return Response.json(
				TEMPLATES.map((t) => ({
					id: t.id,
					name: t.name,
					description: t.description,
					category: t.category,
					defaultAction: t.defaultAction,
					acceptsFiles: t.acceptsFiles,
					hasFileMatch: t.rules.some((r) => !!r.ifClause && r.matcher !== "Bash"),
					rules: t.rules.map((r) => ({
						event: r.event,
						matcher: r.matcher,
						reason: r.reason,
						ifClause: r.ifClause,
					})),
				})),
			);
		}

		if (url.pathname === "/api/preview" && req.method === "POST") {
			const body = (await req.json()) as Array<{ templateId: string; files: string[]; action: string }>;
			const config = generateSettingsJson(body);
			return Response.json({ config });
		}

		if (url.pathname === "/api/apply" && req.method === "POST") {
			const body = (await req.json()) as Array<{ templateId: string; files: string[]; action: string }>;
			const config = generateSettingsJson(body);

			const claudeDir = join(projectDir, ".claude");
			if (!existsSync(claudeDir)) {
				await mkdir(claudeDir, { recursive: true });
			}

			const settingsPath = join(claudeDir, "settings.json");
			let existing: Record<string, unknown> = {};
			if (existsSync(settingsPath)) {
				try {
					existing = JSON.parse(await readFile(settingsPath, "utf-8"));
				} catch {}
			}
			const merged = { ...existing, ...config };
			await writeFile(settingsPath, JSON.stringify(merged, null, 2));

			return Response.json({ success: true, path: settingsPath });
		}

		if (url.pathname === "/api/set-project" && req.method === "POST") {
			const body = (await req.json()) as { path: string };
			if (body.path && existsSync(body.path)) {
				projectDir = body.path;
				return Response.json({ success: true, path: projectDir });
			}
			return Response.json({ success: false, error: "Invalid path" }, { status: 400 });
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(`Hooks Configurator: http://localhost:${server.port}`);
console.log(`Project: ${projectDir}`);
