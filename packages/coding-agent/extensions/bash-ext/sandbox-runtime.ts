import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

type EnvLike = Record<string, string | undefined>;

export interface SandboxRuntimeWrapResult {
  command: string;
  enabled: boolean;
  config?: SandboxRuntimeConfig;
}

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function splitPathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(item));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function isSandboxRuntimeEnabled(env: EnvLike = process.env): boolean {
  return ENABLED_VALUES.has((env.PI_SANDBOX_RUNTIME ?? "").toLowerCase());
}

export function buildSandboxRuntimeConfig(cwd: string, env: EnvLike = process.env): SandboxRuntimeConfig {
  const writeRoots = unique([
    resolve(cwd),
    tmpdir(),
    "/tmp",
    "/private/tmp",
    ...splitPathList(env.PI_SANDBOX_ALLOW_WRITE),
  ]);

  return {
    network: {
      allowedDomains: [],
      deniedDomains: [],
    },
    filesystem: {
      denyRead: splitPathList(env.PI_SANDBOX_DENY_READ),
      allowWrite: writeRoots,
      denyWrite: splitPathList(env.PI_SANDBOX_DENY_WRITE),
    },
  };
}

export async function wrapCommandWithSandboxRuntime(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  env: EnvLike = process.env,
): Promise<SandboxRuntimeWrapResult> {
  if (!isSandboxRuntimeEnabled(env)) {
    return { command, enabled: false };
  }

  const config = buildSandboxRuntimeConfig(cwd, env);
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const wrappedCommand = await SandboxManager.wrapWithSandbox(command, undefined, config, signal);

  return {
    command: wrappedCommand,
    enabled: true,
    config,
  };
}
