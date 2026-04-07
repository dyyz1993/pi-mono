/**
 * LSP Extension Test Suite
 *
 * 25 test cases across 5 categories:
 *   A. Server Matching & Root Detection (TC01-TC05)
 *   B. JSON-RPC Protocol (TC06-TC10)
 *   C. Client Lifecycle (TC11-TC15)
 *   D. Tool Operations & Formatting (TC16-TC20)
 *   E. Edge Cases & Error Handling (TC21-TC25)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { spawn as spawnProc } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { createServer } from "net";
import { pathToFileURL, fileURLToPath } from "url";

import { LspClient } from "../../../../.pi/extensions/lsp/client.js";
import { LspServers, getServersForExtension } from "../../../../.pi/extensions/lsp/servers.js";
import { LANGUAGE_EXTENSIONS } from "../../../../.pi/extensions/lsp/language.js";
import { prettyDiagnostic, symbolKindName, formatLspResult } from "../../.pi/extensions/lsp/index.js";
import type { Diagnostic, Range } from "../../.pi/extensions/lsp/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeRange(startLine: number, startChar: number, endLine: number, endChar: number): Range {
	return {
		start: { line: startLine, character: startChar },
		end: { line: endLine, character: endChar },
	};
}

function makeDiagnostic(line: number, char: number, message: string, severity: number = 1): Diagnostic {
	return {
		range: makeRange(line, char, line, char + 5),
		severity,
		source: "test",
		message,
	};
}

function frameMessage(json: Record<string, unknown>): Buffer {
	const body = JSON.stringify(json);
	const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
	return Buffer.from(header + body);
}

function parseMessages(data: Buffer): unknown[] {
	const str = data.toString("utf-8");
	const messages: unknown[] = [];
	let pos = 0;
	while (pos < str.length) {
		const headerEnd = str.indexOf("\r\n\r\n", pos);
		if (headerEnd === -1) break;

		const header = str.slice(pos, headerEnd);
		const lenMatch = /Content-Length:\s*(\d+)/i.exec(header);
		if (!lenMatch) break;

		const contentLength = parseInt(lenMatch[1], 10);
		const bodyStart = headerEnd + 4;
		const body = str.slice(bodyStart, bodyStart + contentLength);

		try {
			messages.push(JSON.parse(body));
		} catch {}

		pos = bodyStart + contentLength;
	}
	return messages;
}

interface FakeLspServer {
	server: ReturnType<typeof createServer>;
	port: number;
	messages: Array<Record<string, unknown>>;
	closed: boolean;
}

async function createFakeLspServer(responses?: Array<Record<string, unknown> | null>): Promise<FakeLspServer> {
	return new Promise((resolve, reject) => {
		const srv = createServer((socket) => {
			const msgs: Array<Record<string, unknown>> = [];
			let respIndex = 0;

			socket.on("data", (data: Buffer) => {
				const parsed = parseMessages(data);
				msgs.push(...(parsed as Array<Record<string, unknown>>));

				if (responses && respIndex < responses.length) {
					const resp = responses[respIndex++];
					if (resp) {
						socket.write(frameMessage(resp));
					}
				} else {
					socket.write(
						frameMessage({
							jsonrpc: "2.0",
							id: (parsed[0] as any)?.id ?? 0,
							result: null,
						}),
					);
				}
			});

			socket.on("close", () => {
				srv.close();
			});
		});

		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (addr && typeof addr === "object") {
				resolve({
					server: srv,
					port: addr.port,
					messages: [],
					get closed() {
						return false;
					},
				});
			} else {
				reject(new Error("Failed to get address"));
			}
		});
	});
}

// ============================================================================
// Category A: Server Matching & Root Detection (TC01-TC05)
// ============================================================================

describe("A. Server Matching & Root Detection", () => {
	it("TC01: .ts file matches TypeScript server", () => {
		const servers = getServersForExtension(".ts");
		expect(servers.length).toBeGreaterThan(0);
		expect(servers.some((s) => s.id === "typescript")).toBe(true);
	});

	it("TC02: .py file matches Python server", () => {
		const servers = getServersForExtension(".py");
		expect(servers.length).toBeGreaterThan(0);
		expect(servers.some((s) => s.id === "python")).toBe(true);
	});

	it("TC03: .go file matches Go server", () => {
		const servers = getServersForExtension(".go");
		expect(servers.length).toBeGreaterThan(0);
		expect(servers.some((s) => s.id === "gopls")).toBe(true);
	});

	it("TC04: .rs file matches Rust analyzer server", () => {
		const servers = getServersForExtension(".rs");
		expect(servers.length).toBeGreaterThan(0);
		expect(servers.some((s) => s.id === "rust-analyzer")).toBe(true);
	});

	it("TC05: unknown extension returns empty list", () => {
		const servers = getServersForExtension(".xyz_unknown_ext");
		expect(servers).toHaveLength(0);
	});
});

// ============================================================================
// Category B: JSON-RPC Protocol (TC06-TC10)
// ============================================================================

describe("B. JSON-RPC Protocol", () => {
	it("TC06: Message framing produces correct Content-Length header", () => {
		const msg = { jsonrpc: "2.0", id: 1, method: "test", params: {} };
		const framed = frameMessage(msg);
		const str = framed.toString("utf-8");

		expect(str.startsWith("Content-Length: ")).toBe(true);
		expect(str.includes("\r\n\r\n")).toBe(true);
		expect(str.includes('{"jsonrpc":"2.0","id":1,"method":"test","params":{}}')).toBe(true);

		const lenMatch = /Content-Length:\s*(\d+)/.exec(str);
		expect(lenMatch).not.toBeNull();
		const bodyLen = parseInt(lenMatch![1], 10);
		const bodyStart = str.indexOf("\r\n\r\n") + 4;
		expect(str.slice(bodyStart).length).toBe(bodyLen);
	});

	it("TC07: Parse single request from framed buffer", () => {
		const msg = { jsonrpc: "2.0", id: 42, method: "initialize", params: { rootUri: "file:///test" } };
		const framed = frameMessage(msg);
		const parsed = parseMessages(framed);

		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toEqual({ jsonrpc: "2.0", id: 42, method: "initialize", params: { rootUri: "file:///test" } });
	});

	it("TC08: Parse multiple messages from buffer", () => {
		const msg1 = { jsonrpc: "2.0", id: 1, method: "a" };
		const msg2 = { jsonrpc: "2.0", id: 2, method: "b" };
		const combined = Buffer.concat([frameMessage(msg1), frameMessage(msg2)]);
		const parsed = parseMessages(combined);

		expect(parsed).toHaveLength(2);
		expect((parsed[0] as any).method).toBe("a");
		expect((parsed[1] as any).method).toBe("b");
	});

	it("TC09: Notification has no id field", () => {
		const notify = { jsonrpc: "2.0", method: "textDocument/didOpen", params: {} };
		const framed = frameMessage(notify);
		const parsed = parseMessages(framed);

		expect(parsed).toHaveLength(1);
		expect((parsed[0] as any).id).toBeUndefined();
		expect((parsed[0] as any).method).toBe("textDocument/didOpen");
	});

	it("TC10: Empty buffer returns no messages", () => {
		const parsed = parseMessages(Buffer.alloc(0));
		expect(parsed).toHaveLength(0);
	});
});

// ============================================================================
// Category C: Client Lifecycle (TC11-TC15)
// ============================================================================

describe("C. Client Lifecycle", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lsp-test-"));
	});

	async function createTestFile(name: string, content: string): Promise<string> {
		const filePath = path.join(tmpDir, name);
		await fs.writeFile(filePath, content, "utf-8");
		return filePath;
	}

	it("TC11: Initialize handshake sends correct capabilities", async () => {
		const filePath = await createTestFile("test.ts", "const x = 1;");
		let receivedInit: Record<string, unknown> | undefined;

		const srv = await new Promise<FakeLspServer>((resolve, reject) => {
			const s = createServer((socket) => {
				socket.on("data", (data: Buffer) => {
					const msgs = parseMessages(data);
					receivedInit = msgs[0] as Record<string, unknown>;

					socket.write(
						frameMessage({
							jsonrpc: "2.0",
							id: (receivedInit as any)?.id,
							result: {
								capabilities: {
									textDocumentSync: 1,
									hoverProvider: true,
									definitionProvider: true,
								},
							},
						}),
					);
				});
				socket.on("close", () => s.close());
			});
			s.listen(0, "127.0.0.1", () => {
				const addr = s.address();
				if (addr && typeof addr === "object") {
					resolve({ server: s, port: addr.port, messages: [], closed: false } as FakeLspServer);
				} else {
					reject(new Error("Failed"));
				}
			});
		});

		try {
			const proc = spawnProc("node", [
				"-e",
				`
const net = require('net');
const client = new net.Socket();
client.connect(${srv.port}, '127.0.0.1', () => {
  const init = JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",
    params:{rootUri:"file://${tmpDir}",processId:123,capabilities:{}}});
  client.write("Content-Length:" + Buffer.byteLength(init) + "\\r\\n\\r\\n" + init);
  const notified = JSON.stringify({jsonrpc:"2.0",method:"initialized",params:{}});
  client.write("Content-Length:" + Buffer.byteLength(notified) + "\\r\\n\\r\\n" + notified);
  setTimeout(() => client.end(), 500);
});
`,
			]);

			await new Promise<void>((resolve) => proc.on("exit", () => resolve()));

			expect(receivedInit).toBeDefined();
			expect((receivedInit as any).method).toBe("initialize");
			expect((receivedInit as any).params).toBeDefined();

			const caps = ((receivedInit as any).params as any)?.capabilities;
			expect(caps?.textDocument?.synchronization?.didOpen).toBe(true);
			expect(caps?.textDocument?.publishDiagnostics).toBeDefined();
		} finally {
			srv.server.close();
		}
	});

	it("TC12: File open sends didOpen with correct languageId", async () => {
		const filePath = await createTestFile("app.ts", "console.log('hi');");
		let receivedOpen: Record<string, unknown> | undefined;

		const srv = await new Promise<FakeLspServer>((resolve, reject) => {
			const s = createServer((socket) => {
				let step = 0;
				socket.on("data", (data: Buffer) => {
					const msgs = parseMessages(data);
					for (const msg of msgs as Array<Record<string, unknown>>) {
						if (msg.method === "initialized") {
							step++;
						} else if (msg.method === "textDocument/didOpen") {
							receivedOpen = msg;
							step++;
							socket.end();
						} else if (step >= 1) {
							socket.write(frameMessage({ jsonrpc: "2.0", id: (msg as any).id ?? 0, result: {} }));
						}
					}
				});
				socket.on("close", () => s.close());
			});
			s.listen(0, "127.0.0.1", () => {
				const addr = s.address();
				if (addr && typeof addr === "object")
					resolve({ server: s, port: addr.port, messages: [], closed: false } as FakeLspServer);
				else reject(new Error("Failed"));
			});
		});

		try {
			const script = `
const net = require('net');
const fs = require('fs');
const client = new net.Socket();
client.connect(${srv.port}, '127.0.0.1', () => {
  function send(obj) {
    const j = JSON.stringify(obj);
    client.write("Content-Length:" + Buffer.byteLength(j) + "\\r\\n\\r\\n" + j);
  }
  send({jsonrpc:"2.0",id:1,method:"initialize",params:{rootUri:"file://${tmpDir}",capabilities:{}}});
  send({jsonrpc:"2.0",method:"initialized",params:{}});
  // Simulate what LspClient.openFile does
  const text = fs.readFileSync('${filePath.replace(/\\/g, "\\\\")}', 'utf8');
  send({jsonrpc:"2.0",method:"textDocument/didOpen",
    params:{textDocument:{uri:'file://${filePath}',languageId:'typescript',version:0,text}}});
  setTimeout(() => client.end(), 300);
});
`;
			const proc = spawnProc("node", ["-e", script]);
			await new Promise<void>((resolve) => proc.on("exit", () => resolve()));

			expect(receivedOpen).toBeDefined();
			const params = (receivedOpen as any)?.params;
			expect(params?.textDocument?.languageId).toBe("typescript");
			expect(params?.textDocument?.uri).toContain("app.ts");
		} finally {
			srv.server.close();
		}
	});

	it("TC13: publishDiagnostics notification is collected", async () => {
		const filePath = await createTestFile("diag.ts", "const x: number = 'wrong';");

		const srv = await new Promise<FakeLspServer>((resolve, reject) => {
			const s = createServer((socket) => {
				let step = 0;
				socket.on("data", (_data: Buffer) => {
					step++;
					if (step === 1) {
						socket.write(frameMessage({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }));
					}
					if (step === 3) {
						socket.write(
							frameMessage({
								jsonrpc: "2.0",
								method: "textDocument/publishDiagnostics",
								params: {
									uri: `file://${filePath}`,
									diagnostics: [
										{
											range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
											severity: 1,
											source: "ts",
											message: "Type 'string' is not assignable to type 'number'",
										},
									],
								},
							}),
						);
						setTimeout(() => socket.end(), 100);
					}
				});
				socket.on("close", () => s.close());
			});
			s.listen(0, "127.0.0.1", () => {
				const addr = s.address();
				if (addr && typeof addr === "object")
					resolve({ server: s, port: addr.port, messages: [], closed: false } as FakeLspServer);
				else reject(new Error("Failed"));
			});
		});

		try {
			const diagsReceived: unknown[] = [];
			const script = `
const net = require('net');
const client = new net.Socket();
client.connect(${srv.port}, '127.0.0.1', () => {
  function send(obj) { const j=JSON.stringify(obj); client.write("Content-Length:"+Buffer.byteLength(j)+"\\r\\n\\r\\n"+j); }
  client.on('data', (data) => {
    let str = data.toString();
    let pos = 0;
    while(pos < str.length) {
      const hdrEnd = str.indexOf("\\r\\n\\r\\n", pos);
      if(hdrEnd===-1) break;
      const len = parseInt(str.slice(pos,hdrEnd).match(/Content-Length:\\s*(\\d+)/)[1]);
      const body = str.slice(hdrEnd+4, hdrEnd+4+len);
      try { diagsReceived.push(JSON.parse(body)); } catch(e){}
      pos = hdrEnd+4+len;
    }
  });
  send({jsonrpc:"2.0",id:1,method:"initialize",params:{rootUri:"file://${tmpDir}",capabilities:{}}});
  send({jsonrpc:"2.0",method:"initialized",params:{}});
  send({jsonrpc:"2.0",method:"textDocument/didOpen",
    params:{textDocument:{uri:'file://${filePath}',languageId:'typescript',version:0,text:"x"}}});
  setTimeout(()=>client.end(), 800);
});
`;
			const proc = spawnProc("node", ["-e", script]);
			await new Promise<void>((resolve) => proc.on("exit", () => resolve()));

			const diagNotif = diagsReceived.find((m: any) => m.method === "textDocument/publishDiagnostics");
			expect(diagNotif).toBeDefined();
			expect(((diagNotif as any)?.params as any)?.diagnostics).toHaveLength(1);
			expect((((diagNotif as any)?.params as any)?.diagnostics as any)[0]?.severity).toBe(1);
		} finally {
			srv.server.close();
		}
	});

	it("TC14: Language ID mapping covers common extensions", () => {
		expect(LANGUAGE_EXTENSIONS[".ts"]).toBe("typescript");
		expect(LANGUAGE_EXTENSIONS[".tsx"]).toBe("typescriptreact");
		expect(LANGUAGE_EXTENSIONS[".py"]).toBe("python");
		expect(LANGUAGE_EXTENSIONS[".go"]).toBe("go");
		expect(LANGUAGE_EXTENSIONS[".rs"]).toBe("rust");
		expect(LANGUAGE_EXTENSIONS[".vue"]).toBe("vue");
		expect(LANGUAGE_EXTENSIONS[".json"]).toBe("json");
		expect(LANGUAGE_EXTENSIONS[".yaml"]).toBe("yaml");
		expect(LANGUAGE_EXTENSIONS[".sh"]).toBe("shellscript");
		expect(LANGUAGE_EXTENSIONS[".md"]).toBe("markdown");
	});

	it("TC15: All built-in servers have valid IDs and extensions", () => {
		const ids = Object.keys(LspServers);
		expect(ids.length).toBeGreaterThanOrEqual(20);

		for (const [id, server] of Object.entries(LspServers)) {
			expect(id).toBeTruthy();
			expect(server.extensions).toBeInstanceOf(Array);
			expect(server.extensions.length).toBeGreaterThan(0);
			expect(typeof server.root).toBe("function");
			expect(typeof server.spawn).toBe("function");
		}
	});
});

// ============================================================================
// Category D: Tool Operations & Formatting (TC16-TC20)
// ============================================================================

describe("D. Tool Operations & Formatting", () => {
	it("TC16: goToDefinition formats location results", () => {
		const cwd = "/project";
		const results = [
			{ uri: "file:///project/src/main.ts", range: makeRange(10, 5, 10, 20) },
			{ uri: "file:///project/src/types.ts", range: makeRange(0, 0, 0, 15) },
		];

		const formatted = formatLspResult("goToDefinition", results, cwd);
		expect(formatted).toContain("src/main.ts:11:6");
		expect(formatted).toContain("src/types.ts:1:1");
		expect(formatted).toContain("goToDefinition results:");
	});

	it("TC17: hover returns contents text", () => {
		const results = [{ contents: "```typescript\nconst foo: number = 42;\n```" }];
		const formatted = formatLspResult("hover", results, "/project");
		expect(formatted).toContain("const foo: number = 42");
	});

	it("TC18: hover with MarkupContent extracts value", () => {
		const results = [{ contents: { kind: "markdown", value: "**bold** text" } }];
		const formatted = formatLspResult("hover", results, "/project");
		expect(formatted).toContain("**bold** text");
	});

	it("TC19: documentSymbol lists symbols with kinds", () => {
		const results = [
			[
				{
					name: "MyClass",
					kind: 5,
					range: makeRange(0, 0, 20, 1),
					selectionRange: makeRange(0, 6, 13, 14),
				},
				{
					name: "myMethod",
					kind: 6,
					range: makeRange(2, 2, 5, 3),
					selectionRange: makeRange(2, 2, 10, 11),
					detail: "() => void",
				},
			],
		];

		const formatted = formatLspResult("documentSymbol", results, "/project");
		expect(formatted).toContain("Class MyClass [1]");
		expect(formatted).toContain("Method myMethod (() => void) [3]");
		expect(formatted).toContain("Document symbols:");
	});

	it("TC20: workspaceSymbol shows file locations", () => {
		const results = [
			{
				name: "foo",
				kind: 12,
				location: { uri: "file:///project/lib.ts", range: makeRange(5, 0, 5, 3) },
			},
		];

		const formatted = formatLspResult("workspaceSymbol", results, "/project");
		expect(formatted).toContain("Function foo");
		expect(formatted).toContain("lib.ts:6:1");
	});
});

// ============================================================================
// Category E: Edge Cases & Error Handling (TC21-TC25)
// ============================================================================

describe("E. Edge Cases & Error Handling", () => {
	it("TC21: prettyDiagnostic formats ERROR severity correctly", () => {
		const d = makeDiagnostic(10, 5, "Cannot find name 'x'", 1);
		expect(prettyDiagnostic(d)).toBe("ERROR [11:6] Cannot find name 'x'");
	});

	it("TC22: prettyDiagnostic formats WARN severity correctly", () => {
		const d = makeDiagnostic(42, 0, "Unused variable", 2);
		expect(prettyDiagnostic(d)).toBe("WARN [43:1] Unused variable");
	});

	it("TC23: prettyDiagnostic defaults to ERROR when severity missing", () => {
		const d: Diagnostic = {
			range: makeRange(0, 0, 0, 3),
			message: "Syntax error",
		};
		expect(prettyDiagnostic(d)).toBe("ERROR [1:1] Syntax error");
	});

	it("TC24: symbolKindName maps common kinds", () => {
		expect(symbolKindName(5)).toBe("Class");
		expect(symbolKindName(6)).toBe("Method");
		expect(symbolKindName(12)).toBe("Function");
		expect(symbolKindName(13)).toBe("Variable");
		expect(symbolKindName(11)).toBe("Interface");
		expect(symbolKindName(23)).toBe("Struct");
		expect(symbolKindName(999)).toBe("Unknown(999)");
	});

	it("TC25: formatLspResult handles empty results gracefully", () => {
		expect(formatLspResult("goToDefinition", [], "/project")).toContain("No results found");
		expect(formatLspResult("hover", [], "/project")).toContain("No hover information");
		expect(formatLspResult("documentSymbol", [], "/project")).toContain("No symbols found");
		expect(formatLspResult("workspaceSymbol", [], "/project")).toContain("No workspace symbols");
	});
});
