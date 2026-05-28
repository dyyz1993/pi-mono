import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSnapshotHashesFromDir } from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { }
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const d = `/tmp/pi-gc-hash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(d, { recursive: true });
  tempDirs.push(d);
  return d;
}

function writeJsonl(dir: string, filename: string, lines: string[]): void {
  writeFileSync(join(dir, filename), lines.join("\n"));
}

describe("collectSnapshotHashesFromDir", () => {
  it("returns empty set for non-existent directory", () => {
    const hashes = collectSnapshotHashesFromDir("/tmp/does-not-exist-pi-test-xyz");
    expect(hashes.size).toBe(0);
  });

  it("returns empty set for directory with no JSONL files", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "readme.txt"), "hello");
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.size).toBe(0);
  });

  it("collects snapshotTreeHash from step-snapshot entries", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session-abc.jsonl", [
      JSON.stringify({ type: "message", id: "e1" }),
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: "hash-aaa", baselineTreeHash: "hash-bbb" } }),
    ]);
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.has("hash-aaa")).toBe(true);
    expect(hashes.has("hash-bbb")).toBe(true);
    expect(hashes.size).toBe(2);
  });

  it("skips entries that are not step-snapshot", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session.jsonl", [
      JSON.stringify({ type: "message", id: "e1" }),
      JSON.stringify({ customType: "other-type", data: { snapshotTreeHash: "hash-xxx" } }),
    ]);
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.size).toBe(0);
  });

  it("skips lines that do not contain step-snapshot (fast path)", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session.jsonl", [
      JSON.stringify({ type: "message", id: "e1" }),
      "this is not json at all",
      JSON.stringify({ type: "tool_call", id: "e2" }),
    ]);
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.size).toBe(0);
  });

  it("skips malformed JSON lines that contain step-snapshot substring", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session.jsonl", [
      "step-snapshot { broken json }}}",
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: "hash-valid" } }),
    ]);
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.has("hash-valid")).toBe(true);
    expect(hashes.size).toBe(1);
  });

  it("collects hashes from multiple JSONL files", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session-main.jsonl", [
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: "hash-main-1", baselineTreeHash: "hash-base" } }),
    ]);
    writeJsonl(dir, "session-delegate.jsonl", [
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: "hash-delegate-1", baselineTreeHash: "hash-base" } }),
    ]);
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.has("hash-main-1")).toBe(true);
    expect(hashes.has("hash-delegate-1")).toBe(true);
    expect(hashes.has("hash-base")).toBe(true);
    expect(hashes.size).toBe(3);
  });

  it("merges into an existing set passed via into parameter", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session.jsonl", [
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: "hash-new" } }),
    ]);
    const existing = new Set(["hash-existing"]);
    const result = collectSnapshotHashesFromDir(dir, existing);
    expect(result).toBe(existing); // same reference
    expect(result.has("hash-existing")).toBe(true);
    expect(result.has("hash-new")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("handles snapshot entries with null/undefined hash values", () => {
    const dir = makeTempDir();
    writeJsonl(dir, "session.jsonl", [
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: null, baselineTreeHash: undefined } }),
      JSON.stringify({ customType: "step-snapshot", data: { snapshotTreeHash: "hash-present" } }),
    ]);
    const hashes = collectSnapshotHashesFromDir(dir);
    expect(hashes.size).toBe(1);
    expect(hashes.has("hash-present")).toBe(true);
  });
});
