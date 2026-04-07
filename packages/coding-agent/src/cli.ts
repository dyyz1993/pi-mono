#!/usr/bin/env node
process.title = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { writeFileSync } from "fs";
import { join } from "path";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { main } from "./main.js";

const debugDir = process.cwd();
const _ws = (path: string, data: string) => {
	try {
		writeFileSync(path, data, { flag: "a" });
	} catch {}
};

_ws(join(debugDir, "cli-debug.log"), `CLI-INIT at ${new Date().toISOString()}\n`);
_ws(join(debugDir, "cli-debug.log"), `DEBUG_ANTHROPIC_REQUEST=${process.env.DEBUG_ANTHROPIC_REQUEST}\n`);

if (process.env.DEBUG_ANTHROPIC_REQUEST) {
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (url, opts) => {
		const urlStr = typeof url === "string" ? url : (url as any)?.url || String(url);
		_ws("/tmp/pi-fetch-debug.log", `[${new Date().toISOString()}] URL: ${urlStr}\n`);
		_ws("/tmp/pi-fetch-debug.log", `  METHOD: ${opts?.method}\n`);
		if (urlStr?.includes("jdcloud") || urlStr?.includes("anthropic")) {
			const body = typeof opts?.body === "string" ? opts.body?.substring(0, 1000) : "(non-string body)";
			_ws("/tmp/pi-fetch-debug.log", `  BODY: ${body}\n`);
		}
		try {
			const resp = await origFetch(url, opts);
			_ws("/tmp/pi-fetch-debug.log", `  STATUS: ${resp.status}\n`);
			if (!resp.ok && (urlStr?.includes("jdcloud") || urlStr?.includes("anthropic"))) {
				const respText = await resp.text();
				_ws("/tmp/pi-fetch-debug.log", `  ERROR BODY: ${respText.substring(0, 500)}\n`);
				return new Response(respText, { status: resp.status, headers: resp.headers });
			}
			return resp;
		} catch (e) {
			_ws("/tmp/pi-fetch-debug.log", `  EXCEPTION: ${e instanceof Error ? e.message : String(e)}\n`);
			throw e;
		}
	};
}

setGlobalDispatcher(new EnvHttpProxyAgent());
main(process.argv.slice(2));
