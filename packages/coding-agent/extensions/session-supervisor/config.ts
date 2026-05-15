import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { SupervisorConfigSchema, type SupervisorConfig } from "./types.js";

function log(msg: string) {
    const ts = new Date().toISOString();
    appendFileSync("/tmp/supervisor-debug.log", `[${ts}] [config] ${msg}\n`);
}

const DEFAULT_CONFIG: SupervisorConfig = {
    enable: false,
    checkOnAgentEnd: true,
    smallModel: "fast",
    maxContinueCount: 5,
    defaultDelayMs: 30_000,
    pauseThresholdMs: 300_000,
    guards: [
        { name: "incomplete-keywords", type: "keyword", enable: true, keywords: ["TODO", "FIXME", "WIP", "HACK"] },
    ],
};

export function loadConfig(sessionDataDir: string, projectDataDir: string): SupervisorConfig {
    const candidates = [
        join(sessionDataDir, "supervisor.json"),
        join(projectDataDir, "supervisor.json"),
    ];

    for (const p of candidates) {
        if (!existsSync(p)) continue;
        try {
            const raw = readFileSync(p, "utf-8");
            log(`Found config at ${p}, raw length=${raw.length}`);
            const parsed = JSON.parse(raw);
            log(`Parsed guards count: ${parsed.guards?.length ?? "undefined"}`);
            const converted = Value.Convert(SupervisorConfigSchema, parsed) as Record<string, unknown>;
            log(`After Value.Convert guards count: ${Array.isArray(converted.guards) ? converted.guards.length : "undefined"}`);
            const merged = { ...DEFAULT_CONFIG, ...converted } as SupervisorConfig;
            log(`After merge guards count: ${merged.guards?.length ?? "undefined"}`);
            return merged;
        } catch (err) {
            log(`Config parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    log(`No config file found, using defaults`);
    return { ...DEFAULT_CONFIG };
}
