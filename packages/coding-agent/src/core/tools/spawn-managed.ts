import { existsSync } from "node:fs";
import { type ChildProcess, spawn } from "child_process";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.js";

export interface SpawnedProcess {
	child: ChildProcess;
	pid: number | undefined;
	cleanup: () => void;
	isTimedOut: () => boolean;
}

export interface SpawnOptions {
	command: string;
	cwd: string;
	timeout?: number;
	signal?: AbortSignal;
	stdin?: "pipe" | "ignore";
	env?: NodeJS.ProcessEnv;
	shellPath?: string;
}

export function spawnManagedProcess(options: SpawnOptions): SpawnedProcess | Error {
	const { command, cwd, timeout, signal, stdin = "ignore", env, shellPath } = options;

	if (!existsSync(cwd)) {
		return new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
	}

	const { shell, args } = getShellConfig(shellPath);
	const child = spawn(shell, [...args, command], {
		cwd,
		detached: true,
		env: env ?? getShellEnv(),
		stdio: [stdin, "pipe", "pipe"],
	});

	if (child.pid) trackDetachedChildPid(child.pid);

	let timedOut = false;
	let timeoutHandle: NodeJS.Timeout | undefined;

	if (timeout !== undefined && timeout > 0) {
		timeoutHandle = setTimeout(() => {
			timedOut = true;
			if (child.pid) killProcessTree(child.pid);
		}, timeout * 1000);
	}

	const onAbort = () => {
		if (child.pid) killProcessTree(child.pid);
	};

	if (signal) {
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}

	const cleanup = () => {
		if (child.pid) untrackDetachedChildPid(child.pid);
		if (timeoutHandle) clearTimeout(timeoutHandle);
		if (signal) signal.removeEventListener("abort", onAbort);
	};

	return {
		child,
		pid: child.pid ?? undefined,
		cleanup,
		isTimedOut: () => timedOut,
	};
}
