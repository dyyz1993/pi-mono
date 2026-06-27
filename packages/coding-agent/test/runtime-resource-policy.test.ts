import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeContext, getRuntimeKind, getRuntimeResourcePolicy, type RuntimeKind } from "../src/config.ts";

const originalRuntimeKind = process.env.PI_RUNTIME_KIND;
const originalRemoteSshToolProxy = process.env.PI_REMOTE_SSH_TOOL_PROXY;
const originalRemoteSshHost = process.env.PI_REMOTE_SSH_HOST;
const originalRemoteSshCwd = process.env.PI_REMOTE_SSH_CWD;

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	restoreEnv("PI_RUNTIME_KIND", originalRuntimeKind);
	restoreEnv("PI_REMOTE_SSH_TOOL_PROXY", originalRemoteSshToolProxy);
	restoreEnv("PI_REMOTE_SSH_HOST", originalRemoteSshHost);
	restoreEnv("PI_REMOTE_SSH_CWD", originalRemoteSshCwd);
});

describe("runtime resource policy", () => {
	it("defaults to local runtime", () => {
		delete process.env.PI_RUNTIME_KIND;
		delete process.env.PI_REMOTE_SSH_TOOL_PROXY;

		expect(getRuntimeKind()).toBe("local");
		expect(getRuntimeResourcePolicy()).toMatchObject({
			canLoadUserSkills: true,
			canLoadProjectSkills: true,
			canLoadUserAgents: true,
			canLoadProjectAgents: true,
			canLoadUserMemory: true,
			canLoadProjectMemory: true,
			canLoadPlugins: true,
			canLoadHooks: true,
			promptMayMentionLocalPaths: true,
		});
	});

	it("maps legacy SSH tool-proxy env to quick sandbox policy", () => {
		delete process.env.PI_RUNTIME_KIND;
		process.env.PI_REMOTE_SSH_TOOL_PROXY = "1";
		process.env.PI_REMOTE_SSH_HOST = "remote.example";
		process.env.PI_REMOTE_SSH_CWD = "/srv/app";

		expect(getRuntimeKind()).toBe("ssh-command");
		expect(getRuntimeContext({ cwd: "/Users/me/.pi-agent-chat/remote-shadow" })).toMatchObject({
			kind: "ssh-command",
			projectRoot: "/Users/me/.pi-agent-chat/remote-shadow",
			displayProjectRoot: "/srv/app",
			remote: {
				host: "remote.example",
				cwd: "/srv/app",
			},
		});
		expect(getRuntimeResourcePolicy()).toMatchObject({
			canLoadUserSkills: false,
			canLoadProjectSkills: false,
			canLoadUserAgents: false,
			canLoadProjectAgents: false,
			canLoadUserMemory: false,
			canLoadProjectMemory: false,
			canLoadPlugins: false,
			canLoadHooks: false,
			promptMayMentionLocalPaths: false,
		});
	});

	it.each<RuntimeKind>(["remote-agent-child", "remote-server"])(
		"allows remote-owned resources for %s without allowing local path prompt hints",
		(kind) => {
			process.env.PI_RUNTIME_KIND = kind;
			delete process.env.PI_REMOTE_SSH_TOOL_PROXY;

			expect(getRuntimeKind()).toBe(kind);
			expect(getRuntimeResourcePolicy()).toMatchObject({
				canLoadUserSkills: true,
				canLoadProjectSkills: true,
				canLoadUserAgents: true,
				canLoadProjectAgents: true,
				canLoadUserMemory: true,
				canLoadProjectMemory: true,
				canLoadPlugins: true,
				canLoadHooks: true,
				promptMayMentionLocalPaths: false,
			});
		},
	);
});
