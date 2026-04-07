#!/usr/bin/env node
process.title = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

import { createRequire } from "node:module";

// Polyfill require for ESM context BEFORE any imports
// @anthropic-ai/sdk v0.73.0 is pure CJS with 40+ require() calls
if (typeof globalThis.require === "undefined") {
	globalThis.require = createRequire(import.meta.url) as any;
}

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { main } from "./main.js";

setGlobalDispatcher(new EnvHttpProxyAgent());
main(process.argv.slice(2));
