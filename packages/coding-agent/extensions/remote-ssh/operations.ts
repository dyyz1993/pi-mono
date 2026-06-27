import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	BashOperations,
	EditOperations,
	FindOperations,
	GrepOperations,
	LsOperations,
	ReadOperations,
	ToolOperationsProvider,
	WriteOperations,
} from "@dyyz1993/pi-coding-agent";

export interface RemoteSshConfig {
	enabled: boolean;
	host: string;
	remoteCwd: string;
	localCwd?: string;
	sshArgs: string[];
	shell: string;
}

export interface RemoteSshConfigInput {
	enabled?: boolean;
	host?: string;
	remoteCwd?: string;
	localCwd?: string;
	sshArgs?: string[];
	shell?: string;
}

export interface SshRunResult {
	exitCode: number | null;
	stdout: Buffer;
	stderr: Buffer;
}

export interface RemoteSshStatus {
	enabled: boolean;
	configured: boolean;
	host?: string;
	remoteCwd?: string;
	localCwd?: string;
	shell?: string;
	sshArgs?: string[];
}

export interface SshRunner {
	run(command: string, options?: { stdin?: string | Buffer; signal?: AbortSignal }): Promise<SshRunResult>;
	runStreaming(
		command: string,
		options: { onData: (data: Buffer) => void; signal?: AbortSignal },
	): Promise<{ exitCode: number | null }>;
}

export const DEFAULT_REMOTE_SSH_CONFIG: Omit<RemoteSshConfig, "host" | "remoteCwd"> = {
	enabled: false,
	sshArgs: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"],
	shell: "/bin/bash",
};

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function mapLocalPathToRemote(filePath: string, localCwd: string, remoteCwd: string): string {
	const normalizedPath = resolve(filePath);
	const normalizedLocal = resolve(localCwd);
	const normalizedRemote = remoteCwd.replace(/\/+$/, "");
	if (normalizedPath === normalizedLocal) return normalizedRemote || "/";
	if (normalizedPath.startsWith(`${normalizedLocal}/`)) {
		return `${normalizedRemote}${normalizedPath.slice(normalizedLocal.length)}`;
	}
	return filePath;
}

export function mapRemotePathToLocal(filePath: string, localCwd: string, remoteCwd: string): string {
	const normalizedRemote = remoteCwd.replace(/\/+$/, "");
	if (filePath === normalizedRemote) return resolve(localCwd);
	if (filePath.startsWith(`${normalizedRemote}/`)) {
		return `${resolve(localCwd)}${filePath.slice(normalizedRemote.length)}`;
	}
	return filePath;
}

export function normalizeRemoteSshConfig(input: RemoteSshConfigInput, cwd: string): RemoteSshConfig | undefined {
	if (input.enabled === false) return undefined;
	const host = input.host?.trim();
	if (!host) return undefined;
	const remoteCwd = input.remoteCwd?.trim() || cwd;
	return {
		enabled: input.enabled ?? true,
		host,
		remoteCwd,
		localCwd: input.localCwd ?? cwd,
		sshArgs: input.sshArgs ?? DEFAULT_REMOTE_SSH_CONFIG.sshArgs,
		shell: input.shell ?? DEFAULT_REMOTE_SSH_CONFIG.shell,
	};
}

export function loadRemoteSshConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): RemoteSshConfig | undefined {
	const fileConfig = loadRemoteSshConfigFile(cwd);
	const envConfig: RemoteSshConfigInput = {
		enabled: env.PI_REMOTE_SSH_ENABLED ? isEnabledValue(env.PI_REMOTE_SSH_ENABLED) : undefined,
		host: env.PI_REMOTE_SSH_HOST,
		remoteCwd: env.PI_REMOTE_SSH_CWD,
		localCwd: env.PI_REMOTE_LOCAL_CWD,
		shell: env.PI_REMOTE_SSH_SHELL,
		sshArgs: env.PI_REMOTE_SSH_ARGS ? splitArgs(env.PI_REMOTE_SSH_ARGS) : undefined,
	};
	return normalizeRemoteSshConfig({ ...fileConfig, ...definedOnly(envConfig) }, cwd);
}

export async function saveRemoteSshConfig(cwd: string, input: RemoteSshConfigInput): Promise<RemoteSshConfig | undefined> {
	const config = normalizeRemoteSshConfig(input, cwd);
	const dir = join(cwd, ".pi");
	await fsMkdir(dir, { recursive: true });
	const path = join(dir, "remote-ssh.json");
	const json = config
		? {
				enabled: config.enabled,
				host: config.host,
				remoteCwd: config.remoteCwd,
				sshArgs: config.sshArgs,
				shell: config.shell,
			}
		: { enabled: false };
	await fsWriteFile(path, `${JSON.stringify(json, null, 2)}\n`, "utf-8");
	return config;
}

export function toRemoteSshStatus(config: RemoteSshConfig | undefined): RemoteSshStatus {
	return {
		enabled: config?.enabled ?? false,
		configured: Boolean(config?.host && config?.remoteCwd),
		host: config?.host,
		remoteCwd: config?.remoteCwd,
		localCwd: config?.localCwd,
		shell: config?.shell,
		sshArgs: config?.sshArgs,
	};
}

function loadRemoteSshConfigFile(cwd: string): RemoteSshConfigInput {
	const path = join(cwd, ".pi", "remote-ssh.json");
	if (!existsSync(path)) return {};
	const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	return isObject(raw) ? (raw as RemoteSshConfigInput) : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function definedOnly<T extends object>(input: T): Partial<T> {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function isEnabledValue(value: string): boolean {
	return ["1", "true", "yes", "on", "enabled"].includes(value.toLowerCase());
}

function splitArgs(value: string): string[] {
	return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

export function createSshRunner(config: RemoteSshConfig): SshRunner {
	return {
		run(command, options) {
			return runBufferedSsh(config, command, options);
		},
		runStreaming(command, options) {
			return runStreamingSsh(config, command, options);
		},
	};
}

export function createRemoteSshOperations(config: RemoteSshConfig, runner = createSshRunner(config)): ToolOperationsProvider {
	const localCwd = config.localCwd ?? process.cwd();
	const toRemotePath = (path: string) => mapLocalPathToRemote(path, localCwd, config.remoteCwd);
	const toLocalPath = (path: string) => mapRemotePathToLocal(path, localCwd, config.remoteCwd);
	const readFile = async (path: string): Promise<Buffer> => {
		const result = await runner.run(`cat -- ${shellQuote(toRemotePath(path))}`);
		assertOk(result, `Failed to read remote file: ${path}`);
		return result.stdout;
	};
	const writeFile = async (path: string, content: string): Promise<void> => {
		const remotePath = toRemotePath(path);
		const result = await runner.run(`cat > ${shellQuote(remotePath)}`, { stdin: content });
		assertOk(result, `Failed to write remote file: ${path}`);
	};
	const mkdir = async (path: string): Promise<void> => {
		const result = await runner.run(`mkdir -p -- ${shellQuote(toRemotePath(path))}`);
		assertOk(result, `Failed to create remote directory: ${path}`);
	};
	const access = async (path: string, mode = "-r"): Promise<void> => {
		const result = await runner.run(`test ${mode} ${shellQuote(toRemotePath(path))}`);
		assertOk(result, `Remote path is not accessible: ${path}`);
	};

	const read: ReadOperations = {
		readFile,
		access: (path) => access(path, "-r"),
	};
	const write: WriteOperations = { writeFile, mkdir };
	const edit: EditOperations = {
		readFile,
		writeFile,
		access: (path) => access(path, "-r -w"),
	};
	const bash: BashOperations = {
		exec: async (command, cwd, { onData, signal }) => {
			const remoteCwd = toRemotePath(cwd);
			const remoteCommand = `cd -- ${shellQuote(remoteCwd)} && ${config.shell} -lc ${shellQuote(command)}`;
			return runner.runStreaming(remoteCommand, { onData, signal });
		},
	};
	const ls: LsOperations = {
		exists: async (path) => {
			const result = await runner.run(`test -e ${shellQuote(toRemotePath(path))}`);
			return result.exitCode === 0;
		},
		stat: async (path) => {
			const result = await runner.run(`test -d ${shellQuote(toRemotePath(path))}`);
			return { isDirectory: () => result.exitCode === 0 };
		},
		readdir: async (path) => {
			const result = await runner.run(`find ${shellQuote(toRemotePath(path))} -maxdepth 1 -mindepth 1 -exec basename {} \\; | sort`);
			assertOk(result, `Failed to list remote directory: ${path}`);
			return result.stdout.toString("utf-8").split("\n").filter(Boolean);
		},
	};
	const find: FindOperations = {
		exists: ls.exists,
		glob: async (pattern, cwd, options) => {
			const remoteCwd = toRemotePath(cwd);
			const ignoreArgs = options.ignore.flatMap((item) => ["!", "-path", shellQuote(`*/${item}`)]).join(" ");
			const limit = Math.max(1, options.limit);
			const command = [
				`cd -- ${shellQuote(remoteCwd)}`,
				"&&",
				"find .",
				"-type f",
				"-name",
				shellQuote(pattern || "*"),
				ignoreArgs,
				"| sed 's#^./##'",
				"| sort",
				`| head -n ${limit}`,
			].filter(Boolean).join(" ");
			const result = await runner.run(command);
			assertOk(result, `Failed to find remote files in: ${cwd}`);
			return result.stdout.toString("utf-8").split("\n").filter(Boolean);
		},
	};
	const grep: GrepOperations = {
		isDirectory: async (path) => (await ls.stat(path)).isDirectory(),
		readFile: async (path) => (await readFile(path)).toString("utf-8"),
		search: async (pattern, searchPath, options) => {
			const flags = options.ignoreCase ? "-RInH" : "-RInH";
			const literal = options.literal ? "F" : "E";
			const ignoreCase = options.ignoreCase ? "i" : "";
			const command = `grep -${literal}${ignoreCase} ${flags} -- ${shellQuote(pattern)} ${shellQuote(toRemotePath(searchPath))}`;
			const result = await runner.run(command);
			if (result.exitCode === 1) return "";
			assertOk(result, `Failed to grep remote path: ${searchPath}`);
			return result.stdout
				.toString("utf-8")
				.split("\n")
				.map((line) => grepLineToRgJson(line, toLocalPath))
				.filter(Boolean)
				.join("\n");
		},
	};

	return { bash, read, write, edit, ls, find, grep };
}

function grepLineToRgJson(line: string, toLocalPath: (path: string) => string): string | undefined {
	if (!line.trim()) return undefined;
	const first = line.indexOf(":");
	if (first <= 0) return undefined;
	const second = line.indexOf(":", first + 1);
	if (second <= first) return undefined;
	const path = line.slice(0, first);
	const lineNumber = Number(line.slice(first + 1, second));
	if (!Number.isFinite(lineNumber)) return undefined;
	const text = line.slice(second + 1);
	return JSON.stringify({
		type: "match",
		data: {
			path: { text: toLocalPath(path) },
			line_number: lineNumber,
			lines: { text: `${text}\n` },
		},
	});
}

async function runBufferedSsh(
	config: RemoteSshConfig,
	command: string,
	options?: { stdin?: string | Buffer; signal?: AbortSignal },
): Promise<SshRunResult> {
	const chunks: Buffer[] = [];
	const errChunks: Buffer[] = [];
	const result = await runSshProcess(config, command, {
		stdin: options?.stdin,
		signal: options?.signal,
		onStdout: (data) => chunks.push(data),
		onStderr: (data) => errChunks.push(data),
	});
	return { exitCode: result.exitCode, stdout: Buffer.concat(chunks), stderr: Buffer.concat(errChunks) };
}

async function runStreamingSsh(
	config: RemoteSshConfig,
	command: string,
	options: { onData: (data: Buffer) => void; signal?: AbortSignal },
): Promise<{ exitCode: number | null }> {
	return runSshProcess(config, command, {
		signal: options.signal,
		onStdout: options.onData,
		onStderr: options.onData,
	});
}

function runSshProcess(
	config: RemoteSshConfig,
	command: string,
	options: {
		stdin?: string | Buffer;
		signal?: AbortSignal;
		onStdout: (data: Buffer) => void;
		onStderr: (data: Buffer) => void;
	},
): Promise<{ exitCode: number | null }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawnSsh(config, command);
		const onAbort = () => {
			child.kill("SIGTERM");
		};
		child.stdout.on("data", options.onStdout);
		child.stderr.on("data", options.onStderr);
		child.on("error", reject);
		child.on("close", (exitCode) => {
			options.signal?.removeEventListener("abort", onAbort);
			resolvePromise({ exitCode });
		});
		if (options.signal) {
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}
		if (options.stdin !== undefined) {
			child.stdin.end(options.stdin);
		} else {
			child.stdin.end();
		}
	});
}

function spawnSsh(config: RemoteSshConfig, command: string): ChildProcessWithoutNullStreams {
	return spawn("ssh", [...config.sshArgs, config.host, "--", command], {
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
}

function assertOk(result: SshRunResult, message: string): void {
	if (result.exitCode === 0) return;
	const stderr = result.stderr.toString("utf-8").trim();
	const stdout = result.stdout.toString("utf-8").trim();
	throw new Error([message, stderr || stdout].filter(Boolean).join("\n"));
}

export async function assertLocalCwdExists(cwd: string): Promise<void> {
	await fsAccess(cwd, constants.F_OK);
}
