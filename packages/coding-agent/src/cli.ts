#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
process.title = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.DEBUG_ANTHROPIC_REQUEST) {
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (url, opts) => {
		const urlStr = typeof url === "string" ? url : (url as any)?.url || String(url);
		console.error("[FETCH-INTERCEPT] URL:", urlStr);
		console.error("[FETCH-INTERCEPT] METHOD:", opts?.method);
		if (urlStr?.includes("jdcloud") || urlStr?.includes("anthropic")) {
			const body = typeof opts?.body === "string" ? opts.body?.substring(0, 500) : "(non-string body)";
			console.error("[FETCH-INTERCEPT] BODY:", body);
		}
		const resp = await origFetch(url, opts);
		if (!resp.ok && (urlStr?.includes("jdcloud") || urlStr?.includes("anthropic"))) {
			const respText = await resp.text();
			console.error("[FETCH-INTERCEPT] ERROR STATUS:", resp.status, "BODY:", respText.substring(0, 500));
			return new Response(respText, { status: resp.status, headers: resp.headers });
		}
		console.error("[FETCH-INTERCEPT] STATUS:", resp.status);
		return resp;
	};
}

import { main } from "./main.js";

setGlobalDispatcher(new EnvHttpProxyAgent());

main(process.argv.slice(2));
