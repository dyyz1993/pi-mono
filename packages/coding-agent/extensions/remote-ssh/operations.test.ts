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

function result(stdout: string | Buffer = "", exitCode: number | null = 0, stderr = ""): SshRunResult {
	return {
		exitCode,
		stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
		stderr: Buffer.from(stderr),
	};
}

function batchFrame(path: string, content: string | null): Buffer {
	const pathBuffer = Buffer.from(path);
	const contentBuffer = content === null ? null : Buffer.from(content);
	return Buffer.concat([
		Buffer.from(pathBuffer.length.toString(16).padStart(16, "0")),
		pathBuffer,
		Buffer.from(contentBuffer === null ? "ffffffffffffffff" : contentBuffer.length.toString(16).padStart(16, "0")),
		...(contentBuffer === null ? [] : [contentBuffer]),
	]);
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
		const batchOutput = Buffer.concat([
			batchFrame("/Users/remote/project/a.txt", "batch a"),
			batchFrame("/Users/remote/project/missing.txt", null),
		]);
		const fake = createFakeRunner([
			result("remote text"),
			result(),
			result("file\t12\t1234\n"),
			result("file\ta.txt\ndirectory\tsrc\nsymlink\tlink\n"),
			result(),
			result(batchOutput),
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
			{
				path: "/Users/local/project/missing.txt",
				content: null,
				error: "Remote file not found: /Users/remote/project/missing.txt",
			},
		]);

		expect(fake.commands).toEqual([
			"cat -- '/Users/remote/project/a.txt'",
			"mkdir -p -- '/Users/remote/project/sub' && cat > '/Users/remote/project/sub/a.txt'",
			"p='/Users/remote/project/a.txt'; if [ -L \"$p\" ]; then type=symlink; elif [ -d \"$p\" ]; then type=directory; elif [ -f \"$p\" ]; then type=file; else exit 1; fi; size=0; if [ -f \"$p\" ]; then size=$(wc -c < \"$p\" | tr -d ' '); fi; mtime=0; if command -v stat >/dev/null 2>&1; then mtime=$(stat -f %m \"$p\" 2>/dev/null || stat -c %Y \"$p\" 2>/dev/null || echo 0); fi; printf '%s\\t%s\\t%s000\\n' \"$type\" \"$size\" \"$mtime\"",
			"find '/Users/remote/project' -maxdepth 1 -mindepth 1 -exec sh -c 'for p do if [ -L \"$p\" ]; then type=symlink; elif [ -d \"$p\" ]; then type=directory; elif [ -f \"$p\" ]; then type=file; else type=other; fi; printf \"%s\\t%s\\n\" \"$type\" \"$(basename \"$p\")\"; done' sh {} + | sort -k2",
			"rm -rf -- '/Users/remote/project/sub/a.txt'",
			expect.stringContaining("while IFS= read -r -d"),
		]);
		expect(fake.stdin[1]).toBe("new");
		expect(fake.stdin[5]).toEqual(
			Buffer.from("/Users/remote/project/a.txt\0/Users/remote/project/missing.txt\0"),
		);
	});

	it("walks a git workspace with one remote command and maps paths back to local", async () => {
		const walkOutput = Buffer.concat([
			Buffer.from("file\0"),
			Buffer.from("12\0"),
			Buffer.from("/Users/remote/project/src/a.ts\0"),
			Buffer.from("file\0"),
			Buffer.from("4\0"),
			Buffer.from("/Users/remote/project/dist/ignored.js\0"),
		]);
		const fake = createFakeRunner([result(walkOutput)]);
		const ops = createRemoteSshOperations(config, fake.runner);

		await expect(ops.fs!.walk("/Users/local/project", { ignore: ["dist/"], maxFiles: 10 })).resolves.toEqual({
			entries: [{ path: "/Users/local/project/src/a.ts", size: 12, type: "file" }],
			limitReached: false,
		});
		expect(fake.commands).toHaveLength(1);
		expect(fake.commands[0]).toContain("git -C");
		expect(fake.commands[0]).toContain("ls-files -co --exclude-standard -z");
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
