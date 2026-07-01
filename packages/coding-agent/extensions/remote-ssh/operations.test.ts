import { describe, expect, it } from "vitest";
import {
	createRemoteSshOperations,
	mapLocalPathToRemote,
	mapRemotePathToLocal,
	normalizeRemoteSshConfig,
	shellQuote,
	type RemoteSshConfig,
	type SshRunResult,
	type SshRunner,
} from "./operations.ts";

function result(stdout = "", exitCode: number | null = 0, stderr = ""): SshRunResult {
	return {
		exitCode,
		stdout: Buffer.from(stdout),
		stderr: Buffer.from(stderr),
	};
}

function createFakeRunner(responses: SshRunResult[] = []) {
	const commands: string[] = [];
	const stdin: Array<string | Buffer | undefined> = [];
	const streamed: string[] = [];
	const runner: SshRunner = {
		async run(command, options) {
			commands.push(command);
			stdin.push(options?.stdin);
			return responses.shift() ?? result();
		},
		async runStreaming(command, options) {
			streamed.push(command);
			options.onData(Buffer.from("streamed"));
			return { exitCode: 0 };
		},
	};
	return { runner, commands, stdin, streamed };
}

const config: RemoteSshConfig = {
	enabled: true,
	host: "xyz-mac",
	localCwd: "/Users/local/project",
	remoteCwd: "/Users/remote/project",
	sshArgs: ["-o", "BatchMode=yes"],
	shell: "/bin/bash",
};

describe("remote-ssh operations", () => {
	it("quotes shell strings safely", () => {
		expect(shellQuote("simple")).toBe("'simple'");
		expect(shellQuote("it's ok")).toBe("'it'\\''s ok'");
	});

	it("maps local project paths to remote project paths", () => {
		expect(mapLocalPathToRemote("/Users/local/project", config.localCwd!, config.remoteCwd)).toBe(
			"/Users/remote/project",
		);
		expect(mapLocalPathToRemote("/Users/local/project/src/a.ts", config.localCwd!, config.remoteCwd)).toBe(
			"/Users/remote/project/src/a.ts",
		);
		expect(mapLocalPathToRemote("/tmp/a.txt", config.localCwd!, config.remoteCwd)).toBe("/tmp/a.txt");
	});

	it("maps remote grep paths back to local project paths", () => {
		expect(mapRemotePathToLocal("/Users/remote/project/src/a.ts", config.localCwd!, config.remoteCwd)).toBe(
			"/Users/local/project/src/a.ts",
		);
	});

	it("normalizes config from partial input", () => {
		expect(normalizeRemoteSshConfig({ host: "xyz-mac", remoteCwd: "/r" }, "/l")).toMatchObject({
			enabled: true,
			host: "xyz-mac",
			localCwd: "/l",
			remoteCwd: "/r",
		});
		expect(normalizeRemoteSshConfig({ enabled: false, host: "xyz-mac" }, "/l")).toBeUndefined();
		expect(normalizeRemoteSshConfig({}, "/l")).toBeUndefined();
	});

	it("runs bash in the mapped remote cwd", async () => {
		const fake = createFakeRunner();
		const ops = createRemoteSshOperations(config, fake.runner);
		const chunks: string[] = [];
		const output = await ops.bash!.exec("pwd && echo hi", "/Users/local/project", {
			onData: (data) => chunks.push(data.toString("utf-8")),
		});
		expect(output.exitCode).toBe(0);
		expect(chunks).toEqual(["streamed"]);
		expect(fake.streamed[0]).toBe("cd -- '/Users/remote/project' && /bin/bash -lc 'pwd && echo hi'");
	});

	it("reads, writes, and edits through remote paths", async () => {
		const fake = createFakeRunner([result("hello"), result(), result(), result("old")]);
		const ops = createRemoteSshOperations(config, fake.runner);
		await expect(ops.read!.readFile("/Users/local/project/a.txt")).resolves.toEqual(Buffer.from("hello"));
		await expect(ops.write!.mkdir("/Users/local/project/sub")).resolves.toBeUndefined();
		await expect(ops.write!.writeFile("/Users/local/project/sub/a.txt", "new")).resolves.toBeUndefined();
		await expect(ops.edit!.readFile("/Users/local/project/a.txt")).resolves.toEqual(Buffer.from("old"));
		expect(fake.commands).toEqual([
			"cat -- '/Users/remote/project/a.txt'",
			"mkdir -p -- '/Users/remote/project/sub'",
			"cat > '/Users/remote/project/sub/a.txt'",
			"cat -- '/Users/remote/project/a.txt'",
		]);
		expect(fake.stdin[2]).toBe("new");
	});

	it("exposes a workspace fs capability routed through remote paths", async () => {
		const fake = createFakeRunner([
			result("remote text"),
			result(),
			result("file\t12\t1234\n"),
			result("file\ta.txt\ndirectory\tsrc\nsymlink\tlink\n"),
			result(),
			result("batch a"),
			result("", 1, "missing"),
		]);
		const ops = createRemoteSshOperations(config, fake.runner);

		await expect(ops.fs!.readFileText("/Users/local/project/a.txt")).resolves.toBe("remote text");
		await expect(ops.fs!.writeFile("/Users/local/project/sub/a.txt", "new")).resolves.toBeUndefined();
		const stat = await ops.fs!.stat("/Users/local/project/a.txt");
		expect(stat.isFile()).toBe(true);
		expect(stat.isDirectory()).toBe(false);
		expect(stat.size).toBe(12);
		expect(stat.mtimeMs).toBe(1234);
		const dirents = await ops.fs!.readdirWithTypes("/Users/local/project");
		expect(dirents.map((entry) => [entry.name, entry.isFile(), entry.isDirectory(), entry.isSymbolicLink()])).toEqual([
			["a.txt", true, false, false],
			["src", false, true, false],
			["link", false, false, true],
		]);
		await expect(ops.fs!.delete("/Users/local/project/sub/a.txt")).resolves.toBeUndefined();
		await expect(
			ops.fs!.readBatch(["/Users/local/project/a.txt", "/Users/local/project/missing.txt"]),
		).resolves.toEqual([
			{ path: "/Users/local/project/a.txt", content: Buffer.from("batch a") },
			{ path: "/Users/local/project/missing.txt", content: null, error: "missing" },
		]);

		expect(fake.commands).toEqual([
			"cat -- '/Users/remote/project/a.txt'",
			"mkdir -p -- '/Users/remote/project/sub' && cat > '/Users/remote/project/sub/a.txt'",
			"p='/Users/remote/project/a.txt'; if [ -L \"$p\" ]; then type=symlink; elif [ -d \"$p\" ]; then type=directory; elif [ -f \"$p\" ]; then type=file; else exit 1; fi; size=0; if [ -f \"$p\" ]; then size=$(wc -c < \"$p\" | tr -d ' '); fi; mtime=0; if command -v stat >/dev/null 2>&1; then mtime=$(stat -f %m \"$p\" 2>/dev/null || stat -c %Y \"$p\" 2>/dev/null || echo 0); fi; printf '%s\\t%s\\t%s000\\n' \"$type\" \"$size\" \"$mtime\"",
			"find '/Users/remote/project' -maxdepth 1 -mindepth 1 -exec sh -c 'for p do if [ -L \"$p\" ]; then type=symlink; elif [ -d \"$p\" ]; then type=directory; elif [ -f \"$p\" ]; then type=file; else type=other; fi; printf \"%s\\t%s\\n\" \"$type\" \"$(basename \"$p\")\"; done' sh {} + | sort -k2",
			"rm -rf -- '/Users/remote/project/sub/a.txt'",
			"cat -- '/Users/remote/project/a.txt'",
			"cat -- '/Users/remote/project/missing.txt'",
		]);
		expect(fake.stdin[1]).toBe("new");
	});

	it("converts remote grep output to rg json lines", async () => {
		const fake = createFakeRunner([result("/Users/remote/project/src/a.ts:3:hello world\n")]);
		const ops = createRemoteSshOperations(config, fake.runner);
		const output = await ops.grep!.search!("hello", "/Users/local/project", {});
		expect(JSON.parse(output)).toMatchObject({
			type: "match",
			data: {
				path: { text: "/Users/local/project/src/a.ts" },
				line_number: 3,
				lines: { text: "hello world\n" },
			},
		});
	});
});
