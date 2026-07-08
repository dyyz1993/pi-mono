/**
 * `pi subscribe` — stream session events as JSONL until Ctrl+C or a timeout.
 *
 * Registers a single {@link RpcClient.onEvent} listener with optional
 * client-side filtering by extension name and/or event type. Output is one
 * JSON object per line by default (`--pretty` indents). SIGINT tears down the
 * child and exits cleanly.
 */

import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import { RpcClient, type RpcClientOptions } from "../modes/rpc/rpc-client.ts";

export interface SubscribeCliOptions {
	extension?: string;
	type?: string;
	pretty?: boolean;
	timeout?: number;
	remoteSsh?: string;
	provider?: string;
	model?: string;
}

function printHelp(): void {
	console.log(`${APP_NAME} subscribe — stream session events as JSONL

${chalk.bold("Usage:")}
  ${APP_NAME} subscribe [options]

${chalk.bold("Options:")}
  --extension <name>   Only emit events from this extension
  --type <type>        Only emit events of this type (e.g. agent_end, tool_call)
  --timeout <seconds>  Exit after N seconds (default: 0 = run until Ctrl+C)
  --pretty             Pretty-print each event (default: one JSON line)
  --remote-ssh <target> Run the RPC child on a remote SSH host
  --provider <name>    Provider for the spawned agent
  --model <id>         Model id for the spawned agent

${chalk.bold("Examples:")}
  ${APP_NAME} subscribe --pretty
  ${APP_NAME} subscribe --extension todo
  ${APP_NAME} subscribe --type agent_end --timeout 60
  ${APP_NAME} subscribe &
  ${APP_NAME} rpc --method prompt --params '{"message":"hello"}'
`);
}

export function parseSubscribeArgs(args: string[]): {
	options: SubscribeCliOptions;
	help: boolean;
	errors: string[];
} {
	const options: SubscribeCliOptions = {};
	const errors: string[] = [];
	let help = false;

	for (let i = 0; i < args.length; i++) {
		const token = args[i]!;
		const [flag, inline] = token.startsWith("--") ? token.split("=", 2) : [token];

		const value = (): string | undefined => {
			if (inline !== undefined) return inline;
			const next = args[i + 1];
			if (next === undefined || next.startsWith("--")) {
				errors.push(`Option ${flag} requires a value.`);
				return undefined;
			}
			i++;
			return next;
		};

		switch (flag) {
			case "-h":
			case "--help":
				help = true;
				break;
			case "--extension":
				options.extension = value();
				break;
			case "--type":
				options.type = value();
				break;
			case "--pretty":
				options.pretty = true;
				break;
			case "--timeout": {
				const raw = value();
				const n = Number(raw);
				if (!Number.isFinite(n) || n < 0) {
					errors.push(`--timeout must be >= 0, got "${raw}".`);
				} else {
					options.timeout = n;
				}
				break;
			}
			case "--remote-ssh":
				options.remoteSsh = value();
				break;
			case "--provider":
				options.provider = value();
				break;
			case "--model":
				options.model = value();
				break;
			default:
				errors.push(token.startsWith("--") ? `Unknown option ${token}.` : `Unexpected argument "${token}".`);
		}
	}

	return { options, help, errors };
}

function buildClientOptions(opts: SubscribeCliOptions): RpcClientOptions {
	const clientOptions: RpcClientOptions = {};
	if (opts.remoteSsh) {
		clientOptions.remoteSsh = { target: opts.remoteSsh, cwd: process.cwd() };
	}
	if (opts.provider) clientOptions.provider = opts.provider;
	if (opts.model) clientOptions.model = opts.model;
	return clientOptions;
}

export async function runSubscribeCli(args: string[]): Promise<boolean> {
	const { options, help, errors } = parseSubscribeArgs(args);

	if (help || errors.length > 0) {
		for (const msg of errors) console.error(chalk.red(msg));
		printHelp();
		if (errors.length > 0) process.exitCode = 1;
		return true;
	}

	const client = new RpcClient(buildClientOptions(options));
	try {
		await client.start();
	} catch (error) {
		console.error(chalk.red(`Failed to start RPC agent: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
		return true;
	}

	// ── Event listener ──────────────────────────────────────────────────────
	const indent = options.pretty ? 2 : 0;
	const wantExtension = options.extension;
	const wantType = options.type;

	const unsubscribe = client.onEvent((event) => {
		const record = event as Record<string, unknown>;
		if (wantExtension && record.extension !== wantExtension) return;
		if (wantType && record.type !== wantType) return;
		process.stdout.write(JSON.stringify(event, null, indent) + "\n");
	});

	// ── Shutdown coordination ───────────────────────────────────────────────
	// Keep the process alive by awaiting a promise that resolves only when
	// the timeout fires or the user presses Ctrl+C.
	let resolveDone: () => void;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	const timer =
		options.timeout && options.timeout > 0
			? setTimeout(() => {
					unsubscribe();
					resolveDone!();
				}, options.timeout * 1000)
			: undefined;

	process.on("SIGINT", () => {
		if (timer) clearTimeout(timer);
		unsubscribe();
		resolveDone!();
	});

	await done;
	await client.stop();
	return true;
}
