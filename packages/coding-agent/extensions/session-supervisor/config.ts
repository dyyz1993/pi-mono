import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { SupervisorConfigSchema, type SupervisorConfig } from "./types.js";

function log(msg: string) {
    const ts = new Date().toISOString();
    appendFileSync("/tmp/supervisor-debug.log", `[${ts}] [config] ${msg}\n`);
}

const DEFAULT_CONFIG: Static<typeof SupervisorConfigSchema> = {
    enable: true,
    checkOnAgentEnd: true,
    smallModel: "fast",
    maxContinueCount: 5,
    defaultDelayMs: 30_000,
    pauseThresholdMs: 300_000,
    taskRules: [],
};

export function loadConfig(cwd: string): SupervisorConfig {
    const candidates = [
        join(cwd, ".pi", "supervisor.json"),
        join(cwd, "supervisor.json"),
    ];

    for (const p of candidates) {
        if (!existsSync(p)) continue;
        try {
            const raw = readFileSync(p, "utf-8");
            log(`Found config at ${p}, raw length=${raw.length}`);
            const parsed = JSON.parse(raw);
            log(`Parsed taskRules count: ${parsed.taskRules?.length ?? "undefined"}`);
            const config = Value.Convert(SupervisorConfigSchema, parsed);
            log(`After Value.Convert taskRules count: ${config.taskRules?.length ?? "undefined"}`);
            const merged = { ...DEFAULT_CONFIG, ...config };
            log(`After merge taskRules count: ${merged.taskRules?.length ?? "undefined"}`);
            return merged;
        } catch (err) {
            log(`Config parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    log(`No config file found, using defaults`);
    return { ...DEFAULT_CONFIG };
}
