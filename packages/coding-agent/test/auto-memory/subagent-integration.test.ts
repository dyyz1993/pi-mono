import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSubagent } from "./subagent.js";

const hasModelConfig = existsSync(join(homedir(), ".pi/agent/models.json"));

function createTestContext() {
	const sessionId = randomUUID().slice(0, 8);
	const tmpDir = join(tmpdir(), `pi-subagent-e2e-${sessionId}`);
	const sessionPath = join(tmpDir, `subagent-${sessionId}.jsonl`);
	mkdirSync(tmpDir, { recursive: true });
	const events: unknown[] = [];
	const fakeChannel = {
		send: (data: unknown) => {
			events.push(data);
		},
	};
	return { sessionId, tmpDir, sessionPath, events, fakeChannel };
}

function readSessionModel(sessionPath: string) {
	const raw = readFileSync(sessionPath, "utf-8");
	const lines = raw.trim().split("\n").filter(Boolean);
	const modelChange = lines
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.find((e) => e?.type === "model_change");
	return { lines, modelChange };
}

describe.skipIf(!hasModelConfig)("SubAgent E2E --model fallback", () => {
	it("no --model → falls back to global default (zhipuai/glm-4.7)", async () => {
		const { tmpDir, sessionPath, fakeChannel } = createTestContext();

		try {
			const args = [
				"--mode",
				"json",
				"-p",
				"--session",
				sessionPath,
				"--no-extensions",
				"What is 10+20? Reply with just the number.",
			];
			const result = await runSubagent(args, process.cwd(), fakeChannel, "e2e-1", undefined, 60_000);

			expect(result.exitCode).toBe(0);
			expect(result.finalText).toMatch(/30/);

			const { modelChange } = readSessionModel(sessionPath);
			expect(modelChange.provider).toBe("zhipuai");
			expect(modelChange.modelId).toBe("glm-4.7");
		} finally {
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("explicit --model zhipuai/glm-4.7 with provider/model format", async () => {
		const { tmpDir, sessionPath, fakeChannel } = createTestContext();

		try {
			const args = [
				"--mode",
				"json",
				"-p",
				"--session",
				sessionPath,
				"--no-extensions",
				"--model",
				"zhipuai/glm-4.7",
				"What is 2+3? Reply with just the number.",
			];
			const result = await runSubagent(args, process.cwd(), fakeChannel, "e2e-2", undefined, 60_000);

			expect(result.exitCode).toBe(0);
			expect(result.finalText).toMatch(/5/);

			const { modelChange } = readSessionModel(sessionPath);
			expect(modelChange.provider).toBe("zhipuai");
			expect(modelChange.modelId).toBe("glm-4.7");
		} finally {
			try {
				rmSync(tmpDir, { recursive: true, force: true });
			} catch {}
		}
	});
});
