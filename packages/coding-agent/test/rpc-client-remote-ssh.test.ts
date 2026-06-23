import { describe, expect, test } from "vitest";
import { buildRemoteShellCommand, remoteShellQuote, shellQuote } from "../src/modes/rpc/rpc-client.ts";

describe("RpcClient remote SSH command", () => {
	test("quotes shell values safely", () => {
		expect(shellQuote("plain")).toBe("'plain'");
		expect(shellQuote("path with spaces")).toBe("'path with spaces'");
		expect(shellQuote("it's ok")).toBe("'it'\\''s ok'");
		expect(remoteShellQuote("~/pi runtime/path")).toBe('"${HOME}/pi runtime/path"');
	});

	test("builds a remote shell command with cwd, env, node, cli, and args", () => {
		const command = buildRemoteShellCommand({
			remoteCwd: "/tmp/pi remote/project's dir",
			nodePath: "/usr/local/bin/node",
			cliPath: "/Users/xyz/.pi/agent/remote child/pi",
			args: ["--mode", "rpc", "--provider", "openai completions"],
			env: {
				NODE_OPTIONS: "--max-old-space-size=1536",
				PI_CODING_AGENT_DIR: "/tmp/pi agent",
			},
			shell: "zsh -lc",
		});

		expect(command).toBe(
			"zsh -lc 'cd -- '\\''/tmp/pi remote/project'\\''\\'\\'''\\''s dir'\\'' && env NODE_OPTIONS='\\''--max-old-space-size=1536'\\'' PI_CODING_AGENT_DIR='\\''/tmp/pi agent'\\'' '\\''/usr/local/bin/node'\\'' '\\''/Users/xyz/.pi/agent/remote child/pi'\\'' '\\''--mode'\\'' '\\''rpc'\\'' '\\''--provider'\\'' '\\''openai completions'\\'''",
		);
	});

	test("omits node when cliPath is directly executable", () => {
		const command = buildRemoteShellCommand({
			remoteCwd: "~/project",
			nodePath: "",
			cliPath: "~/.pi/agent/runtime/pi",
			args: ["--mode", "rpc", "--extension", "~/.pi/agent/runtime/extensions/auto-memory/index.ts"],
			shell: "/bin/bash -lc",
		});

		expect(command).toBe(
			"/bin/bash -lc 'cd -- \"${HOME}/project\" && \"${HOME}/.pi/agent/runtime/pi\" '\\''--mode'\\'' '\\''rpc'\\'' '\\''--extension'\\'' \"${HOME}/.pi/agent/runtime/extensions/auto-memory/index.ts\"'",
		);
	});
});
