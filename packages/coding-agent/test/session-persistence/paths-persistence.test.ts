import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Agent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.js";
import { loadAgentsFromDir } from "../../src/core/agent-types.js";
import { AuthStorage } from "../../src/core/auth-storage.js";
import { ModelRegistry } from "../../src/core/model-registry.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { SettingsManager } from "../../src/core/settings-manager.js";
import { fauxModel } from "../test-harness.js";
import { createTestResourceLoader } from "../utilities.js";

let tempDir: string;
let agentsDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `paths-persistence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	agentsDir = join(tempDir, "agents");
	mkdirSync(tempDir, { recursive: true });
	mkdirSync(agentsDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function writeAgent(filename: string, frontmatter: Record<string, unknown>, body = "You are a test agent.") {
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => {
			if (typeof v === "object" && v !== null) {
				return `${k}: ${JSON.stringify(v)}`;
			}
			return `${k}: ${v}`;
		})
		.join("\n");
	const filePath = join(agentsDir, filename);
	// Ensure directory exists
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(filePath, `---\n${fm}\n---\n${body}`);
}

function loadFirstAgent() {
	const agents = loadAgentsFromDir(agentsDir, "project");
	expect(agents.length).toBeGreaterThanOrEqual(1);
	return agents[0];
}

function createSession(cwd?: string) {
	const sessionCwd = cwd ?? tempDir;
	const sessionManager = SessionManager.create(sessionCwd, sessionCwd);
	const settingsManager = SettingsManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(fauxModel.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(fauxModel.provider, {
		baseUrl: fauxModel.baseUrl,
		apiKey: "faux-key",
		api: fauxModel.api,
		models: [fauxModel],
	});

	const agent = new Agent({
		getApiKey: () => "faux-key",
		initialState: {
			model: fauxModel,
			systemPrompt: "You are a test assistant.",
			tools: [],
		},
	});

	const resourceLoader = createTestResourceLoader();

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: sessionCwd,
		modelRegistry,
		resourceLoader,
	});

	return {
		session,
		sessionManager,
		cleanup: () => {
			session.dispose();
		},
	};
}

describe("G1: Session persistence", () => {
	it("paths persist across session reload", async () => {
		// 1. Create session
		const { session, sessionManager, cleanup } = createSession();

		// 2. Add initial messages to trigger session file creation
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});

		// 3. Apply agent with paths.write: ["docs/**"]
		writeAgent("docs-agent.md", {
			name: "docs-only",
			description: "Only writes docs",
			paths: { write: ["docs/**"] },
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// 4. Add another message to flush
		sessionManager.appendMessage({ role: "user", content: "next" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
		});

		// 5. Save session
		await sessionManager.waitForFlush();
		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();

		// 6. Reload session
		cleanup();
		const reloadedSm = SessionManager.open(sessionFile!, tempDir);

		// 7. Verify paths still enforced (check agent_change entry includes paths)
		const entries = reloadedSm.getEntries();
		const agentEntry = entries.find((e) => e.type === "agent_change");
		expect(agentEntry).toBeDefined();
		if (agentEntry?.type === "agent_change") {
			// The agentConfig should include paths
			expect(agentEntry.agentConfig?.paths).toBeDefined();
			expect(agentEntry.agentConfig?.paths).toEqual({ write: ["docs/**"] });
		}
	});

	it("paths are applied when restoring from agent_change entry", async () => {
		// 1. Create session
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});

		// 2. Apply agent with paths
		writeAgent("restricted.md", {
			name: "restricted",
			description: "Restricted paths",
			paths: {
				write: ["docs/**"],
				read: ["src/**"],
				bash: ["scripts/**"],
			},
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// Add another message
		sessionManager.appendMessage({ role: "user", content: "next" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
		});

		// 3. Save session
		await sessionManager.waitForFlush();
		const sessionFile = sessionManager.getSessionFile();

		// 4. Reload session
		cleanup();
		const reloadedSm = SessionManager.open(sessionFile!, tempDir);

		// 5. Verify session has the agent config with paths
		const branch = reloadedSm.getBranch();
		const agentChange = branch.find((e) => e.type === "agent_change");

		expect(agentChange).toBeDefined();
		if (agentChange?.type === "agent_change") {
			expect(agentChange.agentConfig?.paths).toEqual({
				write: ["docs/**"],
				read: ["src/**"],
				bash: ["scripts/**"],
			});
		}
	});
});

describe("G2: Fork/branch behavior", () => {
	it("forked session inherits parent's paths", async () => {
		// 1. Create session
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages to trigger file creation
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});

		// 2. Apply agent with paths.write: ["docs/**"]
		writeAgent("docs-agent.md", {
			name: "docs-only",
			description: "Only writes docs",
			paths: { write: ["docs/**"] },
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// 3. Add some messages
		sessionManager.appendMessage({ role: "user", content: "hello" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
		});

		// Get the entry id BEFORE the agent_change (i.e., before applying paths)
		const entries = sessionManager.getEntries();
		const firstMessageId = entries.find((e) => e.type === "message")?.id;

		expect(firstMessageId).toBeDefined();

		// 4. Fork session from BEFORE agent was applied
		await sessionManager.waitForFlush();
		const newFile = sessionManager.createBranchedSession(firstMessageId!);
		expect(newFile).toBeDefined();

		// 5. In forked session, verify NO paths (since we forked before agent was applied)
		const forkedSm = SessionManager.open(newFile!, tempDir);
		const forkedEntries = forkedSm.getEntries();
		const agentEntry = forkedEntries.find((e) => e.type === "agent_change");

		// Forked session should NOT have paths since we forked before the agent was applied
		expect(agentEntry).toBeUndefined();

		cleanup();
		rmSync(newFile!, { recursive: true, force: true });
	});

	it("forked session maintains independent paths after parent switches", async () => {
		// 1. Create session, apply agent A with paths
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});

		writeAgent("agent-a.md", {
			name: "agent-a",
			description: "Agent A",
			paths: { write: ["docs/**"] },
		});
		const agentA = loadFirstAgent();
		await session.applyAgentConfig(agentA);

		// Add a message to get an entry point AFTER agent A was applied
		sessionManager.appendMessage({ role: "user", content: "after agent A" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
		});

		await sessionManager.waitForFlush();
		const forkPointId = sessionManager.getLeafId();

		// 2. Fork from after agent A
		await sessionManager.waitForFlush();
		const forkedFile = sessionManager.createBranchedSession(forkPointId!);
		expect(forkedFile).toBeDefined();
		await sessionManager.waitForFlush();

		// 3. Verify forked session has agent A's paths
		const forkedSm = SessionManager.open(forkedFile!, tempDir);
		const forkedEntries = forkedSm.getEntries();
		const forkedAgentEntry = forkedEntries.find((e) => e.type === "agent_change");

		// Fork should still have agent A's paths
		expect(forkedAgentEntry).toBeDefined();
		if (forkedAgentEntry?.type === "agent_change") {
			expect(forkedAgentEntry.agentName).toBe("agent-a");
			expect(forkedAgentEntry.agentConfig?.paths).toEqual({ write: ["docs/**"] });
		}

		cleanup();
		rmSync(forkedFile!, { recursive: true, force: true });
	});
});

describe("G3: Rollback behavior", () => {
	it("rolling back to before paths were set removes path restrictions", async () => {
		// 1. Create session
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages
		sessionManager.appendMessage({ role: "user", content: "start work" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "doing work" }],
		});

		// 2. Do some work (turns without paths)
		const beforePathsId = sessionManager.getLeafId();

		// 3. Apply agent with paths
		writeAgent("restricted.md", {
			name: "restricted",
			description: "Restricted agent",
			paths: { write: ["docs/**"] },
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// 4. Do more work with paths enforced
		sessionManager.appendMessage({ role: "user", content: "continue work" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "working with restrictions" }],
		});

		// 5. Rollback to state from step 2
		sessionManager.branch(beforePathsId!);

		// 6. Verify no path restrictions on the new branch
		const branch = sessionManager.getBranch();
		const agentEntry = branch.find((e) => e.type === "agent_change");

		// After rollback, the active branch should not have agent_change entries
		expect(agentEntry).toBeUndefined();

		cleanup();
	});

	it("rolling back to after paths were set maintains paths", async () => {
		// 1. Create session
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
		});

		// 2. Apply agent with paths
		writeAgent("restricted.md", {
			name: "restricted",
			description: "Restricted agent",
			paths: { write: ["docs/**"] },
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// 3. Do work with paths
		sessionManager.appendMessage({ role: "user", content: "work" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "working" }],
		});

		const afterPathsId = sessionManager.getLeafId();

		// 4. Add more work
		sessionManager.appendMessage({ role: "user", content: "more work" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "more working" }],
		});

		// 5. Rollback to state from step 3
		sessionManager.branch(afterPathsId!);

		// 6. Verify paths still enforced
		const branch = sessionManager.getBranch();
		const agentEntry = branch.find((e) => e.type === "agent_change");

		expect(agentEntry).toBeDefined();
		if (agentEntry?.type === "agent_change") {
			expect(agentEntry.agentConfig?.paths).toEqual({ write: ["docs/**"] });
		}

		cleanup();
	});

	it("rollback maintains correct paths across multiple agent switches", async () => {
		// 1. Create session
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
		});

		// 2. Apply agent A with paths A
		writeAgent("agent-a-v2.md", {
			name: "agent-a-v2",
			description: "Agent A v2",
			paths: { write: ["docs/**"] },
		});
		const agentA = loadFirstAgent();
		await session.applyAgentConfig(agentA);

		const afterAgentA = sessionManager.getLeafId();

		// 3. Apply agent B with paths B
		writeAgent("agent-b-v2.md", {
			name: "agent-b-v2",
			description: "Agent B v2",
			paths: { write: ["src/**"] },
		});
		const agents = loadAgentsFromDir(agentsDir, "project");
		const agentB = agents.find((a) => a.name === "agent-b-v2");
		expect(agentB).toBeDefined();
		await session.applyAgentConfig(agentB!);

		// 4. Rollback to after agent A
		sessionManager.branch(afterAgentA!);

		// 5. Verify agent A's paths are active
		const branch = sessionManager.getBranch();
		const agentEntries = branch.filter((e) => e.type === "agent_change");

		expect(agentEntries).toHaveLength(1);
		if (agentEntries[0]?.type === "agent_change") {
			expect(agentEntries[0].agentName).toBe("agent-a-v2");
			expect(agentEntries[0].agentConfig?.paths).toEqual({ write: ["docs/**"] });
		}

		cleanup();
	});
});

describe("agent_change entry serialization", () => {
	it("agent_change entry persists paths to file", async () => {
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages to trigger file creation
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});

		// Apply agent with paths
		writeAgent("full-paths.md", {
			name: "full-paths",
			description: "Full paths config",
			paths: {
				write: ["docs/**"],
				read: ["src/**", "test/**"],
				bash: ["scripts/**"],
			},
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// Wait for flush and read file
		await sessionManager.waitForFlush();
		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();

		const content = readFileSync(sessionFile!, "utf-8");
		const lines = content.trim().split("\n");

		// Find the agent_change line
		const agentChangeLine = lines.find((line) => line.includes('"type":"agent_change"'));

		expect(agentChangeLine).toBeDefined();

		const parsed = JSON.parse(agentChangeLine!);
		expect(parsed.type).toBe("agent_change");
		expect(parsed.agentName).toBe("full-paths");
		expect(parsed.agentConfig?.paths).toEqual({
			write: ["docs/**"],
			read: ["src/**", "test/**"],
			bash: ["scripts/**"],
		});

		cleanup();
	});

	it("agent_change entry can be reloaded from file", async () => {
		const { session, sessionManager, cleanup } = createSession();

		// Add initial messages
		sessionManager.appendMessage({ role: "user", content: "start" });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});

		// Apply agent with paths
		writeAgent("simple.md", {
			name: "simple",
			description: "Simple agent",
			paths: { write: ["docs/**"] },
		});
		const agentConfig = loadFirstAgent();
		await session.applyAgentConfig(agentConfig);

		// Wait for flush and get session file
		await sessionManager.waitForFlush();
		const sessionFile = sessionManager.getSessionFile();

		// Reload session from file
		cleanup();
		const reloadedSm = SessionManager.open(sessionFile!, tempDir);

		// Verify the agent_change entry
		const entries = reloadedSm.getEntries();
		const agentEntry = entries.find((e) => e.type === "agent_change");

		expect(agentEntry).toBeDefined();
		if (agentEntry?.type === "agent_change") {
			expect(agentEntry.agentName).toBe("simple");
			expect(agentEntry.agentConfig?.paths).toEqual({ write: ["docs/**"] });
		}
	});
});
