#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
process.title = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { writeFileSync } from "fs";
writeFileSync("/tmp/pi-cli-debug.log", `CLI-INIT at ${new Date().toISOString()}\n`);
writeFileSync("/tmp/pi-cli-debug.log", `DEBUG_ANTHROPIC_REQUEST=${process.env.DEBUG_ANTHROPIC_REQUEST}\n`, {
	flag: "a",
});
writeFileSync("/tmp/pi-cli-debug.log", `Global fetch type: ${typeof globalThis.fetch}\n`, { flag: "a" });

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.DEBUG_ANTHROPIC_REQUEST) {
	const origFetch = globalThis.fetch;
	const { writeFileSync: _ws } = require("fs");
	globalThis.fetch = async (url, opts) => {
		const urlStr = typeof url === "string" ? url : (url as any)?.url || String(url);
		_ws("/tmp/pi-fetch-debug.log", `[${new Date().toISOString()}] URL: ${urlStr}\n`, { flag: "a" });
		_ws("/tmp/pi-fetch-debug.log", `  METHOD: ${opts?.method}\n`, { flag: "a" });
		if (urlStr?.includes("jdcloud") || urlStr?.includes("anthropic")) {
			const body = typeof opts?.body === "string" ? opts.body?.substring(0, 1000) : "(non-string body)";
			_ws("/tmp/pi-fetch-debug.log", `  BODY: ${body}\n`, { flag: "a" });
		}
		try {
			const resp = await origFetch(url, opts);
			_ws("/tmp/pi-fetch-debug.log", `  STATUS: ${resp.status}\n`, { flag: "a" });
			if (!resp.ok && (urlStr?.includes("jdcloud") || urlStr?.includes("anthropic"))) {
				const respText = await resp.text();
				_ws("/tmp/pi-fetch-debug.log", `  ERROR BODY: ${respText.substring(0, 500)}\n`, { flag: "a" });
				return new Response(respText, { status: resp.status, headers: resp.headers });
			}
			return resp;
		} catch (e) {
			_ws("/tmp/pi-fetch-debug.log", `  EXCEPTION: ${e instanceof Error ? e.message : e}\n`, { flag: "a" });
			throw e;
		}
	};
}

import { main } from "./main.js";

setGlobalDispatcher(new EnvHttpProxyAgent());

main(process.argv.slice(2));
