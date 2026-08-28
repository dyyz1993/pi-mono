/**
 * Channel method tests for goal-vendor's "goal" channel.
 *
 * Uses the same ExtensionRunner + ChannelManager harness pattern as
 * builtin-extensions.test.ts. Invokes channel methods via the JSONL
 * channel_data protocol and asserts return shapes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../../src/core/extensions/channel-types.ts";
import { discoverAndLoadExtensions } from "../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions, ToolInfo } from "../../src/core/extensions/types.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mockTools: ToolInfo[] = [];
const mockToolSourceInfo = {
	path: "builtin:test",
	source: "builtin",
	scope: "temporary",
	origin: "top-level",
} satisfies ToolInfo["sourceInfo"];

function goalVendorSourcePath(): string {
	return path.resolve(__dirname, "../../extensions/goal-vendor/index.ts");
}

function createCapturingChannelManager(): { manager: ChannelManager; outputs: ChannelDataMessage[] } {
	const outputs: ChannelDataMessage[] = [];
	const outputFn: ChannelOutputFn = (msg) => {
		outputs.push(msg);
	};
	return { manager: new ChannelManager(outputFn), outputs };
}

function findResponse(
	outputs: ChannelDataMessage[],
	channelName: string,
	invokeId: string,
): Record<string, unknown> | undefined {
	const msg = outputs.find(
		(m) => m.name === channelName && (m.data as Record<string, unknown>)?.invokeId === invokeId,
	);
	return msg ? (msg.data as Record<string, unknown>) : undefined;
}

async function invokeChannelMethod(
	manager: ChannelManager,
	outputs: ChannelDataMessage[],
	channelName: string,
	method: string,
	params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const invokeId = `test-${channelName}-${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	manager.handleInbound({
		type: "channel_data",
		name: channelName,
		data: { __call: method, ...(params ?? {}), invokeId },
	});
	for (let i = 0; i < 100; i++) {
		const response = findResponse(outputs, channelName, invokeId);
		if (response) return response;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`No response for ${channelName}.${method} within timeout`);
}

const extensionActions: ExtensionActions = {
	sendMessage: () => {},
	sendUserMessage: () => {},
	appendEntry: ((type: string) => `entry-${type}-${Date.now()}`) as unknown as ExtensionActions["appendEntry"],
	deleteEntries: () => {},
	summarizeEntries: () => {},
	setSessionName: () => {},
	getSessionName: () => undefined,
	setLabel: () => {},
	getActiveTools: () => [],
	getAllTools: () => mockTools,
	setActiveTools: () => {},
	refreshTools: () => {},
	setToolOperationsProvider: () => {},
	getToolOperationsProvider: () => undefined,
	getCommands: () => [],
	setModel: async () => false,
	getThinkingLevel: () => "off",
	setThinkingLevel: () => {},
	registerChannel: (name) => ({
		name,
		send: () => {},
		onReceive: () => () => {},
		invoke: async () => ({}),
		call: async () => ({}),
	}),
	callLLM: async () => "refined objective",
};

const extensionContextActions: ExtensionContextActions = {
	getModel: () => undefined,
	isIdle: () => true,
	isProjectTrusted: () => true,
	getSignal: () => undefined,
	abort: () => {},
	hasPendingMessages: () => false,
	shutdown: () => {},
	getContextUsage: () => undefined,
	compact: () => {},
	getSystemPrompt: () => "",
	getSettings: () => ({}),
};

describe("goal-vendor channel", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-vendor-channel-"));
		mockTools = [];
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function loadGoalVendor(): Promise<{
		runner: ExtensionRunner;
		manager: ChannelManager;
		outputs: ChannelDataMessage[];
	}> {
		const result = await discoverAndLoadExtensions([goalVendorSourcePath()], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		const { manager, outputs } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));
		runner.updateRegisterChannel((name) => manager.register(name));

		const storeDir = path.join(tempDir, ".pi-snapshot-store");
		fs.mkdirSync(storeDir, { recursive: true });
		const git = new InternalGit(storeDir);
		const snapshotManager = new FileSnapshotManager(git);
		snapshotManager.initialize(tempDir);
		runner.setFileSnapshotManagerFn(() => snapshotManager);
		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });

		return { runner, manager, outputs };
	}

	it("registers a 'goal' channel", async () => {
		const { manager } = await loadGoalVendor();
		expect(manager.has("goal")).toBe(true);
	});

	it("getStatus returns idle status when no goal is active", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(response.state).toBe("idle");
		expect(response.enabled).toBe(true);
		expect(response.rawStatus).toBe("none");
	});

	it("disable sets enabled=false and state=disabled", async () => {
		const { manager, outputs } = await loadGoalVendor();
		await invokeChannelMethod(manager, outputs, "goal", "disable");
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.enabled).toBe(false);
		expect(status.state).toBe("disabled");
	});

	it("enable restores enabled=true", async () => {
		const { manager, outputs } = await loadGoalVendor();
		await invokeChannelMethod(manager, outputs, "goal", "disable");
		await invokeChannelMethod(manager, outputs, "goal", "enable");
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.enabled).toBe(true);
	});

	it("getTaskReport returns empty tasks when no goal is active", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "getTaskReport");
		expect(response.tasks).toEqual([]);
	});

	it("getTriggerHistory returns empty triggers when no events logged", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "getTriggerHistory");
		expect(response.triggers).toEqual([]);
	});

	it("refineGoal returns a refined objective", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "refineGoal", {
			objective: "build a feature",
		});
		expect(response.success).toBe(true);
		expect(typeof response.objective).toBe("string");
	});

	it("refineGoal rejects empty objective", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "refineGoal", { objective: "" });
		expect(response.success).toBe(false);
		expect(response.error).toBeDefined();
	});

	it("approveContract fails when no goal is awaiting approval", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "approveContract");
		expect(response.approved).toBe(false);
	});

	it("rejectAuthorityAmendment fails when no amendment is pending", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "rejectAuthorityAmendment");
		expect(response.rejected).toBe(false);
		expect(response.error).toBeDefined();
	});

	it("submitContract records a validated channel contract for approval", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		fs.writeFileSync(path.join(root, "README.md"), "# Tetris\n");
		fs.writeFileSync(path.join(root, "QUICK_CREATE_DELIVERY.md"), "# Delivery\n");
		const response = await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Create a dependency-free Tetris game",
			workspaceRoots: [root],
			criteria: [
				"Playable dependency-free Tetris page exists",
				"Validation packet records automated and manual checks",
			],
			phases: [
				{
					id: "P1",
					title: "Implement game",
					criterionIds: ["AC1"],
				},
				{
					id: "P2",
					title: "Validate delivery",
					dependsOn: ["P1"],
					criterionIds: ["AC2"],
				},
			],
			verificationChecks: [
				{ id: "VC1", kind: "file_exists", label: "README exists", path: path.join(root, "README.md") },
				{
					id: "VC2",
					kind: "file_exists",
					label: "Quick-create delivery protocol exists",
					path: path.join(root, "QUICK_CREATE_DELIVERY.md"),
				},
			],
			authorities: [],
			constraints: ["Do not require dependency installation"],
			nonGoals: ["Publishing or deployment"],
		});
		expect(response).toMatchObject({ submitted: true });
		expect(response.status).toBe("awaiting_approval");

		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.rawStatus).toBe("awaiting_approval");

		const approval = await invokeChannelMethod(manager, outputs, "goal", "approveContract");
		expect(approval.approved).toBe(true);

		const running = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(running.state).toBe("running");
	});

	it("keeps safe tools available during authority approval and resolves rejection through the channel", async () => {
		mockTools = [
			{
				name: "read",
				description: "Read a file from the workspace.",
				parameters: {},
				sourceInfo: mockToolSourceInfo,
			} as ToolInfo,
			{
				name: "bash",
				description: "Run shell commands.",
				parameters: {},
				sourceInfo: mockToolSourceInfo,
			} as ToolInfo,
		];
		const { runner, manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		const readmePath = path.join(root, "README.md");
		fs.writeFileSync(readmePath, "# Goal\n");
		await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Inspect and validate the workspace",
			workspaceRoots: [root],
			criteria: ["README exists"],
			phases: [{ id: "P1", title: "Inspect workspace", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "VC1", kind: "file_exists", label: "README exists", path: readmePath }],
			authorities: [],
			constraints: [],
			nonGoals: [],
		});
		await invokeChannelMethod(manager, outputs, "goal", "approveContract");
		const running = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		const requestTool = runner
			.getAllRegisteredTools()
			.find((tool) => tool.definition.name === "pi_goal_request_authority_amendment");
		expect(requestTool).toBeDefined();
		await requestTool!.definition.execute(
			"call-request-authority",
			{
				goalId: running.goalId,
				generation: running.generation,
				rationale: "Need the generated preview server for UI validation",
				authorities: [
					{
						id: "AUTH_NODE_PREVIEW",
						label: "Start exact preview server",
						actionClass: "local_process",
						toolName: "bash",
						targets: [
							{ path: "command.executable", equals: "node" },
							{ path: "cwd", equals: root },
						],
						command: { executable: "node", argsPrefix: ["scripts/preview-server.mjs"], trailingArgs: "none" },
						maxUses: 1,
					},
				],
			} as never,
			undefined,
			undefined,
			runner.createContext(),
		);

		const readDecision = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "call-read",
			toolName: "read",
			input: { path: readmePath },
		});
		const questionDecision = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "call-question",
			toolName: "ask-user-question",
			input: { question: "Need clarification" },
		});
		const deniedDecision = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "call-node",
			toolName: "bash",
			input: { command: "node scripts/preview-server.mjs" },
		});
		expect(readDecision).toBeUndefined();
		expect(questionDecision).toBeUndefined();
		expect(deniedDecision?.block).toBe(true);

		const rejection = await invokeChannelMethod(manager, outputs, "goal", "rejectAuthorityAmendment", {
			reason: "Use the already generated file instead",
		});
		expect(rejection).toMatchObject({ rejected: true });
		const resumed = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(resumed.rawStatus).toBe("running");
		expect(resumed.interrupt).toBeUndefined();
	});

	it("keeps running after a synchronous tool result from a background-capable tool", async () => {
		mockTools = [
			{
				name: "bash",
				description: "Run shell commands and optionally manage background jobs.",
				parameters: {},
				sourceInfo: mockToolSourceInfo,
			} as ToolInfo,
		];
		const { runner, manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		fs.writeFileSync(path.join(root, "README.md"), "# Tetris\n");
		fs.writeFileSync(path.join(root, "QUICK_CREATE_DELIVERY.md"), "# Delivery\n");
		await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Create a dependency-free Tetris game",
			workspaceRoots: [root],
			criteria: ["Playable dependency-free Tetris page exists"],
			phases: [{ id: "P1", title: "Implement game", criterionIds: ["AC1"] }],
			verificationChecks: [
				{ id: "VC1", kind: "file_exists", label: "README exists", path: path.join(root, "README.md") },
			],
			authorities: [],
			constraints: ["Do not require dependency installation"],
			nonGoals: [],
		});
		await invokeChannelMethod(manager, outputs, "goal", "approveContract");

		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "call-bash-sync",
			toolName: "bash",
			input: { command: "ls -la" },
			content: [{ type: "text", text: "total 0" }],
			details: { exitCode: 0 },
			isError: false,
		});

		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.state).toBe("running");
		expect(status.rawStatus).toBe("running");
	});

	it("does not treat nested rule status metadata as background work", async () => {
		mockTools = [
			{
				name: "read",
				description: "Read a file from the workspace.",
				parameters: {},
				sourceInfo: mockToolSourceInfo,
			} as ToolInfo,
		];
		const { runner, manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		fs.writeFileSync(path.join(root, "README.md"), "# Tetris\n");
		fs.writeFileSync(path.join(root, "QUICK_CREATE_DELIVERY.md"), "# Delivery\n");
		await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Create a dependency-free Tetris game",
			workspaceRoots: [root],
			criteria: ["Playable dependency-free Tetris page exists"],
			phases: [{ id: "P1", title: "Implement game", criterionIds: ["AC1"] }],
			verificationChecks: [
				{ id: "VC1", kind: "file_exists", label: "README exists", path: path.join(root, "README.md") },
			],
			authorities: [],
			constraints: ["Do not require dependency installation"],
			nonGoals: [],
		});
		await invokeChannelMethod(manager, outputs, "goal", "approveContract");

		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "call-read-rules",
			toolName: "read",
			input: { path: path.join(root, "README.md") },
			content: [{ type: "text", text: "# Tetris" }],
			details: {
				rulesMatched: [{ name: "documentation-standard", severity: "medium", status: "loaded" }],
			},
			isError: false,
		});

		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.state).toBe("running");
		expect(status.rawStatus).toBe("running");
	});

	it("records evidence when toolCallIds contains a tool name alias", async () => {
		const { runner, manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		const readmePath = path.join(root, "README.md");
		fs.writeFileSync(readmePath, "# Tetris\n");
		await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Create a dependency-free Tetris game",
			workspaceRoots: [root],
			criteria: ["Playable dependency-free Tetris page exists"],
			phases: [{ id: "P1", title: "Implement game", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "VC1", kind: "file_exists", label: "README exists", path: readmePath }],
			authorities: [],
			constraints: ["Do not require dependency installation"],
			nonGoals: [],
		});
		await invokeChannelMethod(manager, outputs, "goal", "approveContract");

		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "call-read-latest",
			toolName: "read",
			input: { path: readmePath },
			content: [{ type: "text", text: "# Tetris" }],
			details: {},
			isError: false,
		});

		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		const recordTool = runner
			.getAllRegisteredTools()
			.find((tool) => tool.definition.name === "pi_goal_record_evidence");
		expect(recordTool).toBeDefined();
		await recordTool!.definition.execute(
			"call-record-evidence",
			{
				goalId: status.goalId,
				generation: status.generation,
				summary: "README was read successfully",
				toolCallIds: ["read"],
				criterionIds: ["AC1"],
				nodeId: "P1",
			} as never,
			undefined,
			undefined,
			runner.createContext(),
		);

		const report = await invokeChannelMethod(manager, outputs, "goal", "getTaskReport");
		expect(report.tasks).toEqual([expect.objectContaining({ id: "AC1", hasEvidence: true })]);
	});

	it("settles after a goal tool result clears its active tool marker", async () => {
		const { runner, manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		const readmePath = path.join(root, "README.md");
		fs.writeFileSync(readmePath, "# Tetris\n");
		await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Create a dependency-free Tetris game",
			workspaceRoots: [root],
			criteria: ["Playable dependency-free Tetris page exists"],
			phases: [{ id: "P1", title: "Implement game", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "VC1", kind: "file_exists", label: "README exists", path: readmePath }],
			authorities: [],
			constraints: ["Do not require dependency installation"],
			nonGoals: [],
		});
		await invokeChannelMethod(manager, outputs, "goal", "approveContract");

		await runner.emit({
			type: "tool_execution_start",
			toolCallId: "call-goal-status",
			toolName: "pi_goal_status",
			args: {},
			timestamp: Date.now(),
		});
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "call-goal-status",
			toolName: "pi_goal_status",
			input: {},
			content: [{ type: "text", text: "status" }],
			details: {},
			isError: false,
		});
		await runner.emit({ type: "agent_end", messages: [] });

		const history = await invokeChannelMethod(manager, outputs, "goal", "getTriggerHistory");
		const eventTypes = (history.triggers as Array<{ eventType: string }>).map((trigger) => trigger.eventType);
		expect(eventTypes).toContain("evaluation_started");
	});

	it("resumes a pending completion audit on session_start", async () => {
		const { runner, manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		const readmePath = path.join(root, "README.md");
		fs.writeFileSync(readmePath, "# Tetris\n");
		await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "Create a dependency-free Tetris game",
			workspaceRoots: [root],
			criteria: ["Playable dependency-free Tetris page exists"],
			phases: [{ id: "P1", title: "Implement game", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "VC1", kind: "file_exists", label: "README exists", path: readmePath }],
			authorities: [],
			constraints: ["Do not require dependency installation"],
			nonGoals: [],
		});
		await invokeChannelMethod(manager, outputs, "goal", "approveContract");
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "call-read-latest",
			toolName: "read",
			input: { path: readmePath },
			content: [{ type: "text", text: "# Tetris" }],
			details: {},
			isError: false,
		});

		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		const recordTool = runner
			.getAllRegisteredTools()
			.find((tool) => tool.definition.name === "pi_goal_record_evidence");
		const submitTool = runner
			.getAllRegisteredTools()
			.find((tool) => tool.definition.name === "pi_goal_submit_completion_candidate");
		expect(recordTool).toBeDefined();
		expect(submitTool).toBeDefined();
		await recordTool!.definition.execute(
			"call-record-evidence",
			{
				goalId: status.goalId,
				generation: status.generation,
				summary: "README proves the deliverable exists",
				toolCallIds: ["read"],
				criterionIds: ["AC1"],
				nodeId: "P1",
			} as never,
			undefined,
			undefined,
			runner.createContext(),
		);
		await submitTool!.definition.execute(
			"call-submit-completion",
			{ goalId: status.goalId, generation: status.generation, summary: "Ready for final audit" } as never,
			undefined,
			undefined,
			runner.createContext(),
		);

		await runner.emit({ type: "session_start", reason: "startup" });

		const history = await invokeChannelMethod(manager, outputs, "goal", "getTriggerHistory");
		const eventTypes = (history.triggers as Array<{ eventType: string }>).map((trigger) => trigger.eventType);
		expect(eventTypes).toContain("audit_started");
		expect(eventTypes).toContain("audit_error");
	});

	it("clearGoal returns cleared=false when no goal exists", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "clearGoal");
		expect(response.cleared).toBe(false);
	});

	it("forceContinue returns triggered=false when no active goal", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "forceContinue");
		expect(response.triggered).toBe(false);
	});

	it("rewrites an executable-name toolName with a typed command policy into a bash authority", async () => {
		// Models (GLM) sometimes fill toolName with the executable name ("node")
		// on an authority that is otherwise a fully typed bash command policy.
		// With combined target normalization this must submit, not burn a retry.
		mockTools = [
			{ name: "read", description: "Read a file from the workspace.", parameters: {}, sourceInfo: mockToolSourceInfo } as ToolInfo,
			{ name: "bash", description: "Run shell commands.", parameters: {}, sourceInfo: mockToolSourceInfo } as ToolInfo,
		];
		const { manager, outputs } = await loadGoalVendor();
		const root = fs.realpathSync(tempDir);
		await invokeChannelMethod(manager, outputs, "goal", "startSetup", { objective: "verify report.txt with node --check" });
		const submitted = await invokeChannelMethod(manager, outputs, "goal", "submitContract", {
			outcome: "verify report.txt with node --check",
			criteria: ["report.txt exists in the workspace and is valid"],
			phases: [{ id: "P1", title: "verify the report", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "V1", kind: "command_exit", label: "node check", command: "node --check report.txt" }],
			authorities: [{
				id: "A_NODE_CHECK",
				label: "node check",
				toolName: "node",
				actionClass: "local_process",
				targets: [{ path: root, equals: root }],
				command: { executable: "node", argsPrefix: ["--check"], trailingArgs: "single_value" },
				maxUses: 10,
			}],
		});
		expect(submitted.submitted).toBe(true);
		const pending = await invokeChannelMethod(manager, outputs, "goal", "getPendingContract");
		expect((pending.authorities as Array<{ toolName: string }>)[0]?.toolName).toBe("bash");
	});
});
