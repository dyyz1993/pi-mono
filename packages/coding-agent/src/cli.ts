#!/usr/bin/env node
process.title = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { createRequire } from "node:module";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { main } from "./main.js";

// Polyfill require for ESM context (needed by @anthropic-ai/sdk v0.73.0 error handling)
if (typeof globalThis.require === "undefined") {
	const _require = createRequire(import.meta.url);
	globalThis.require = _require as any;
}

setGlobalDispatcher(new EnvHttpProxyAgent());
main(process.argv.slice(2));
