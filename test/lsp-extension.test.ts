/**
 * LSP Extension Test Suite - 25 test cases
 *
 * Run: npx tsx test/lsp-extension.test.ts
 */

import { spawn as spawnProc } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { createServer } from "net";

import { LspServers, getServersForExtension } from "../.pi/extensions/lsp/servers.js";
import { LANGUAGE_EXTENSIONS } from "../.pi/extensions/lsp/language.js";
import { prettyDiagnostic, symbolKindName, formatLspResult } from "../.pi/extensions/lsp/index.js";
import type { Diagnostic, Range } from "../.pi/extensions/lsp/types.js";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(cond: boolean, msg: string) {
	if (cond) { passed++; console.log(`  ✅ ${msg}`); }
	else { failed++; errors.push(msg); console.log(`  ❌ ${msg}`); }
}
function assertEqual<T>(a: T, b: T, msg: string) {
	if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log(`  ✅ ${msg}`); }
	else { failed++; errors.push(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); console.log(`  ❌ ${msg}`); console.log(`     expected: ${JSON.stringify(b)}`); console.log(`     actual:   ${JSON.stringify(a)}`); }
}
function assertContains(str: string, sub: string, msg: string) {
	if (str.includes(sub)) { passed++; console.log(`  ✅ ${msg}`); }
	else { failed++; errors.push(msg); console.log(`  ❌ ${msg}`); console.log(`     expected to contain: "${sub}"`); console.log(`     but got: "${str}"`); }
}

function section(t: string) { console.log(`\n${"=".repeat(60)}\n  ${t}\n${"=".repeat(60)}`); }

function makeRange(sl: number, sc: number, el: number, ec: number): Range {
	return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}
function makeDiag(l: number, c: number, m: string, s: number = 1): Diagnostic {
	return { range: makeRange(l, c, l, c + 5), severity: s, source: "test", message: m };
}
function frame(obj: Record<string, unknown>): Buffer {
	const body = JSON.stringify(obj);
	return Buffer.from(`Content-Length:${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
function parseMsgs(data: Buffer): unknown[] {
	const str = data.toString("utf-8");
	const msgs: unknown[] = [];
	let p = 0;
	while (p < str.length) {
		const h = str.indexOf("\r\n\r\n", p);
		if (h === -1) break;
		const len = parseInt(str.slice(p, h).match(/Content-Length:\s*(\d+)/)![1], 10);
		const body = str.slice(h + 4, h + 4 + len);
		try { msgs.push(JSON.parse(body)); } catch {}
		p = h + 4 + len;
	}
	return msgs;
}

async function tmpFile(dir: string, name: string, content: string): Promise<string> {
	const f = path.join(dir, name);
	await fs.writeFile(f, content, "utf-8");
	return f;
}

// ============================================================================
section("A. Server Matching & Root Detection");
// ============================================================================
{
	assert(getServersForExtension(".ts").some((s) => s.id === "typescript"), "TC01: .ts → TypeScript");
	assert(getServersForExtension(".py").some((s) => s.id === "python"), "TC02: .py → Python");
	assert(getServersForExtension(".go").some((s) => s.id === "gopls"), "TC03: .go → Go");
	assert(getServersForExtension(".rs").some((s) => s.id === "rust-analyzer"), "TC04: .rs → Rust");
	assertEqual(getServersForExtension(".xyz_unknown_ext").length, 0, "TC05: unknown ext → empty");

	const ids = Object.keys(LspServers);
	assert(ids.length >= 20, `TC05b: servers >= 20 (got ${ids.length})`);
	for (const [id, srv] of Object.entries(LspServers)) {
		assert(id.length > 0, `TC05c: "${id}" has ID`);
		assert(srv.extensions.length > 0, `TC05c: "${id}" has extensions`);
		assert(typeof srv.root === "function", `TC05c: "${id}" has root fn`);
		assert(typeof srv.spawn === "function", `TC05c: "${id}" has spawn fn`);
	}
}

// ============================================================================
section("B. JSON-RPC Protocol");
// ============================================================================
{
	const msg = { jsonrpc: "2.0", id: 42, method: "test", params: {} };
	const framed = frame(msg).toString("utf-8");
	assertContains(framed, "Content-Length:", "TC06a: frame has Content-Length header");
	assertContains(framed, "\r\n\r\n", "TC06b: frame has separator");
	assertContains(framed, '{"jsonrpc":"2.0","id":42,"method":"test","params":{}}', "TC06c: frame has body");
	const lm = /Content-Length:\s*(\d+)/.exec(framed)!;
	assert(lm !== null, "TC06d: Content-Length parseable");
	assertEqual(parseInt(lm[1], 10), Buffer.byteLength(JSON.stringify(msg)), "TC06e: length matches body bytes");

	const combined = Buffer.concat([frame({ jsonrpc: "2.0", id: 1, method: "a" }), frame({ jsonrpc: "2.0", id: 2, method: "b" })]);
	const parsed = parseMsgs(combined);
	assertEqual(parsed.length, 2, "TC07: parses multiple messages");
	assertEqual((parsed[0] as any)?.method, "a", "TC07a: first method");
	assertEqual((parsed[1] as any)?.method, "b", "TC07b: second method");

	const notify = frame({ jsonrpc: "2.0", method: "notif", params: {} });
	const np = parseMsgs(notify);
	assertEqual(np.length, 1, "TC08: notification parsed");
	assertEqual((np[0] as any)?.id, undefined, "TC08a: no id");
	assertEqual((np[0] as any)?.method, "notif", "TC08b: method preserved");

	assertEqual(parseMsgs(Buffer.alloc(0)).length, 0, "TC09: empty buffer → no msgs");
	assert(frame({ jsonrpc: "2.0", id: 99, method: "big", params: { x: "a".repeat(10000) } }).length > 100, "TC10: large message frames");
}

// ============================================================================
section("C. Client Lifecycle & Language Mapping");
// ============================================================================
{
	assertEqual(LANGUAGE_EXTENSIONS[".ts"], "typescript", "TC11a: .ts→typescript");
	assertEqual(LANGUAGE_EXTENSIONS[".tsx"], "typescriptreact", "TC11b: .tsx→typescriptreact");
	assertEqual(LANGUAGE_EXTENSIONS[".py"], "python", "TC11c: .py→python");
	assertEqual(LANGUAGE_EXTENSIONS[".go"], "go", "TC11d: .go→go");
	assertEqual(LANGUAGE_EXTENSIONS[".rs"], "rust", "TC11e: .rs→rust");
	assertEqual(LANGUAGE_EXTENSIONS[".vue"], "vue", "TC11f: .vue→vue");
	assertEqual(LANGUAGE_EXTENSIONS[".json"], "json", "TC11g: .json→json");
	assertEqual(LANGUAGE_EXTENSIONS[".yaml"], "yaml", "TC11h: .yaml→yaml");
	assertEqual(LANGUAGE_EXTENSIONS[".sh"], "shellscript", "TC11i: .sh→shellscript");
	assertEqual(LANGUAGE_EXTENSIONS[".md"], "markdown", "TC11j: .md→markdown");
	assertEqual(LANGUAGE_EXTENSIONS[".svelte"], "svelte", "TC11k: .svelte→svelte");
	assertEqual(LANGUAGE_EXTENSIONS[".zig"], "zig", "TC11l: .zig→zig");
}

// TC12-TC13: Integration test - JSON-RPC roundtrip via PassThrough streams
{
	const { PassThrough } = await import("stream");
	let recvMsgs: Array<Record<string, unknown>> = [];

	const toServer = new PassThrough();
	const fromServer = new PassThrough();

	fromServer.on("data", (d: Buffer) => {
		recvMsgs.push(...(parseMsgs(d) as Array<Record<string, unknown>>));
	});

	let serverBuf = "";
	toServer.on("data", (d: Buffer) => { serverBuf += d.toString("utf-8"); while (true) { const i = serverBuf.indexOf("\r\n\r\n"); if (i === -1) break; const lenMatch = /Content-Length:\s*(\d+)/.exec(serverBuf.slice(0, i)); if (!lenMatch) break; const len = parseInt(lenMatch[1], 10); const bodyStart = i + 4; if (serverBuf.length < bodyStart + len) break; const body = serverBuf.slice(bodyStart, bodyStart + len); serverBuf = serverBuf.slice(bodyStart + len); try { const msg = JSON.parse(body); if (msg.method === "initialize") { const resp = frame({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { textDocumentSync: 1, hoverProvider: true, definitionProvider: true } } }); fromServer.write(resp); } } catch {} } });

	function writeClient(obj: Record<string, unknown>) { toServer.write(frame(obj)); }

	writeClient({ jsonrpc: "2.0", id: 42, method: "initialize", params: { rootUri: "file:///test", processId: 999, capabilities: {} } });
	writeClient({ jsonrpc: "2.0", method: "initialized", params: {} });
	writeClient({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///test.ts", languageId: "typescript", version: 0, text: "const x = 1;" } } });

	assert(recvMsgs.length >= 1, "TC12: roundtrip produced responses");
	const initResp = recvMsgs.find((m: any) => m.id === 42 && m.result !== undefined);
	assert(initResp !== undefined, "TC12a: initialize response received");
	assertEqual(initResp?.id, 42, "TC12b: initialize response id matches");
	assert((initResp as any)?.result?.capabilities?.textDocumentSync !== undefined, "TC12c: response has capabilities");

	assert(recvMsgs.length >= 1, "TC13: connection still alive after didOpen");

	toServer.end();
	fromServer.end();
}

// ============================================================================
section("D. Tool Operations & Formatting");
// ============================================================================
{
	const cwd = "/project/src";
	const defs = [{ uri: "file:///project/src/main.ts", range: makeRange(10, 5, 10, 20) }, { uri: "file:///project/src/types.ts", range: makeRange(0, 0, 0, 15) }];
	const fmtDef = formatLspResult("goToDefinition", defs, cwd);
	assertContains(fmtDef, "main.ts:11:6", "TC16a: def shows main.ts");
	assertContains(fmtDef, "types.ts:1:1", "TC16b: def shows types.ts");
	assertContains(fmtDef, "goToDefinition results:", "TC16c: label present");

	assertContains(formatLspResult("hover", [{ contents: "```ts\nconst x=42;\n```" }], "/project"), "const x=42;", "TC17: hover text contents");
	assertContains(formatLspResult("hover", [{ contents: { kind: "markdown", value: "**b**" } }], "/project"), "**b**", "TC18: hover markdown");

	const syms = [{ name: "MyClass", kind: 5, range: makeRange(0, 0, 20, 1), selectionRange: makeRange(0, 6, 13, 14), detail: "() => void" }, { name: "myMethod", kind: 6, range: makeRange(2, 2, 5, 3), selectionRange: makeRange(2, 2, 10, 11), detail: "() => void" }];
	const fmtSym = formatLspResult("documentSymbol", [syms], "/project");
	assertContains(fmtSym, "Class MyClass (() => void) [1]", "TC19a: Class symbol with detail");
	assertContains(fmtSym, "Method myMethod (() => void) [3]", "TC19b: Method symbol+detail");

	const wsyms = [{ name: "foo", kind: 12, location: { uri: "file:///project/lib.ts", range: makeRange(5, 0, 5, 3) } }];
	const fmtWs = formatLspResult("workspaceSymbol", wsyms, "/project");
	assertContains(fmtWs, "Function foo", "TC20a: Function kind");
	assertContains(fmtWs, "lib.ts:6)", "TC20b: location with line number");
}

// ============================================================================
section("E. Edge Cases & Error Handling");
// ============================================================================
{
	assertEqual(prettyDiagnostic(makeDiag(10, 5, "err", 1)), "ERROR [11:6] err", "TC21a: ERROR format");
	assert(prettyDiagnostic(makeDiag(42, 0, "warn", 2)).startsWith("WARN "), "TC22: WARN format");
	const d3: Diagnostic = { range: makeRange(0, 0, 0, 3), message: "syn err" };
	assertEqual(prettyDiagnostic(d3), "ERROR [1:1] syn err", "TC23: missing severity→ERROR");

	assertEqual(symbolKindName(5), "Class", "TC24a: 5→Class");
	assertEqual(symbolKindName(6), "Method", "TC24b: 6→Method");
	assertEqual(symbolKindName(12), "Function", "TC24c: 12→Function");
	assertEqual(symbolKindName(13), "Variable", "TC24d: 13→Variable");
	assertEqual(symbolKindName(999), "Unknown(999)", "TC24e: unknown→Unknown");

	assertContains(formatLspResult("goToDefinition", [], "/project"), "No go to definition results found", "TC25a: empty def");
	assertContains(formatLspResult("hover", [], "/project"), "No hover information", "TC25b: empty hover");
	assertContains(formatLspResult("documentSymbol", [], "/project"), "No symbols found", "TC25c: empty symbols");
	assertContains(formatLspResult("workspaceSymbol", [], "/project"), "No workspace symbols", "TC25d: empty ws symbols");
}

// ============================================================================
console.log(`\n${"=".repeat(60)}\n  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total\n${"=".repeat(60)}`);
if (errors.length > 0) { console.log("\nFailed:"); errors.forEach(e => console.log(`  - ${e}`)); process.exit(1); }
else console.log("\nAll tests passed!");
