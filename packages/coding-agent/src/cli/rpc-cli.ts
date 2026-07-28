/**
 * `pi rpc` — invoke a single RPC method and print the JSON response.
 *
 * Spawns a `pi --mode rpc` child via {@link RpcClient}, sends one command,
 * prints the full response object to stdout, and exits. The child's stdin is
 * owned by the client (not the caller's stdin), so this bypasses the
 * `echo | pi --mode rpc` EOF race documented at `rpc-mode.ts:1314`.
 */

import { readFileSync } from "node:fs";

import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import { RpcClient, type RpcClientOptions, type RpcCommandBody } from "../modes/rpc/rpc-client.ts";
import type { RpcResponse } from "../modes/rpc/rpc-types.ts";
import { RPC_COMMAND_GROUPS, RPC_COMMAND_TABLE } from "./rpc-commands-table.ts";

export interface RpcCliOptions {
	method?: string;
	params?: string;
	paramsFile?: string;
	timeout?: number;
	session?: string;
	pretty?: boolean;
	listCommands?: boolean;
	remoteSsh?: string;
	provider?: string;
	model?: string;
}

const EXIT_OK = 0;
const EXIT_RPC_ERROR = 1;
const EXIT_CONNECTION_ERROR = 2;

function printHelp(): void {
	console.log(`${APP_NAME} rpc — invoke an RPC method and print the response

${chalk.bold("Usage:")}
  ${APP_NAME} rpc --method <method> [--params '<json>'] [options]
  ${APP_NAME} rpc --list-commands

${chalk.bold("Options:")}
  --method <name>          RPC method to invoke (e.g. get_state, prompt)
  --params '<json>'        JSON object merged into the command body
  --params-file <path>     Read params JSON from a file (use "-" for stdin)
  --timeout <seconds>      Response wait timeout (default: 30)
  --session <id>           switch_session before sending the command
  --list-commands          List all RPC methods grouped by category, then exit
  --remote-ssh <target>    Run the RPC child on a remote SSH host
  --provider <name>        Provider for the spawned agent
  --model <id>             Model id for the spawned agent
  --pretty                 Pretty-print JSON output (default: compact)

${chalk.bold("Exit codes:")}
  0  success
  1  RPC returned an error (success: false)
  2  connection / timeout / parse error

${chalk.bold("Examples:")}
  ${APP_NAME} rpc --method get_state | jq .
  ${APP_NAME} rpc --method prompt --params '{"message":"hello"}'
  ${APP_NAME} rpc --method get_messages --session <sessionId>
  ${APP_NAME} rpc --list-commands
`);
}

/** Parse a flat `--key value` / `--key=value` / boolean-flag token stream. */
export function parseRpcCliArgs(args: string[]): {
	options: RpcCliOptions;
	help: boolean;
	errors: string[];
} {
	const options: RpcCliOptions = {};
	const errors: string[] = [];
	let help = false;

	const need = (flag: string, i: number): string | undefined => {
		const eq = args[i]?.indexOf("=");
		if (eq !== undefined && eq >= 0) {
			return args[i]!.slice(eq + 1);
		}
		const next = args[i + 1];
		if (next === undefined || next.startsWith("--")) {
			errors.push(`Option ${flag} requires a value.`);
			return undefined;
		}
		return next;
	};

	for (let i = 0; i < args.length; i++) {
		const token = args[i]!;
		const [flag, inline] = token.startsWith("--") ? token.split("=", 2) : [token];

		switch (flag) {
			case "-h":
			case "--help":
				help = true;
				break;
			case "--method":
				options.method = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			case "--params":
				options.params = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			case "--params-file":
				options.paramsFile = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			case "--timeout": {
				const raw = inline ?? need(flag, i);
				if (!inline) i++;
				const n = Number(raw);
				if (!Number.isFinite(n) || n <= 0) {
					errors.push(`--timeout must be a positive number, got "${raw}".`);
				} else {
					options.timeout = n;
				}
				break;
			}
			case "--session":
				options.session = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			case "--list-commands":
				options.listCommands = true;
				break;
			case "--pretty":
				options.pretty = true;
				break;
			case "--remote-ssh":
				options.remoteSsh = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			case "--provider":
				options.provider = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			case "--model":
				options.model = inline ?? need(flag, i);
				if (!inline) i++;
				break;
			default:
				if (token.startsWith("--")) {
					errors.push(`Unknown option ${token}.`);
				} else {
					errors.push(`Unexpected positional argument "${token}".`);
				}
		}
	}

	return { options, help, errors };
}

export function printCommandList(): void {
	for (const group of RPC_COMMAND_GROUPS) {
		const entries = RPC_COMMAND_TABLE.filter((e) => e.group === group);
		if (entries.length === 0) continue;
		console.log(chalk.bold(`\n${group}`));
		for (const entry of entries) {
			console.log(`  ${chalk.cyan(entry.name.padEnd(28))} ${entry.summary}`);
		}
	}
	const total = RPC_COMMAND_TABLE.length;
	console.log(chalk.dim(`\n${total} commands. See docs/rpc/rpc-commands-*.md for parameter details.`));
}

function readParamsFile(path: string): string {
	if (path === "-") {
		return readFileSync(0, "utf8");
	}
	return readFileSync(path, "utf8");
}

/** Merge `--method` + parsed params into a command body the server accepts. */
export function buildCommandBody(method: string, paramsJson: string | undefined): Record<string, unknown> {
	let params: Record<string, unknown> = {};
	if (paramsJson !== undefined && paramsJson.trim() !== "") {
		try {
			const parsed: unknown = JSON.parse(paramsJson);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("params must be a JSON object");
			}
			params = parsed as Record<string, unknown>;
		} catch (error) {
			throw new Error(`Invalid --params JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { type: method, ...params } as Record<string, unknown>;
}

function buildClientOptions(opts: RpcCliOptions): RpcClientOptions {
	const clientOptions: RpcClientOptions = {};
	if (opts.remoteSsh) {
		clientOptions.remoteSsh = { target: opts.remoteSsh, cwd: process.cwd() };
	}
	if (opts.provider) clientOptions.provider = opts.provider;
	if (opts.model) clientOptions.model = opts.model;
	return clientOptions;
}

export async function runRpcCli(args: string[]): Promise<boolean> {
	const { options, help, errors } = parseRpcCliArgs(args);

	if (help) {
		printHelp();
		return true;
	}

	if (errors.length > 0) {
		for (const msg of errors) console.error(chalk.red(msg));
		printHelp();
		process.exitCode = EXIT_CONNECTION_ERROR;
		return true;
	}

	if (options.listCommands) {
		printCommandList();
		return true;
	}

	if (!options.method) {
		console.error(chalk.red("--method is required (or use --list-commands)."));
		printHelp();
		process.exitCode = EXIT_CONNECTION_ERROR;
		return true;
	}

	let paramsJson: string | undefined;
	if (options.params !== undefined) paramsJson = options.params;
	if (options.paramsFile !== undefined) {
		try {
			paramsJson = readParamsFile(options.paramsFile);
		} catch (error) {
			console.error(
				chalk.red(`Failed to read --params-file: ${error instanceof Error ? error.message : String(error)}`),
			);
			process.exitCode = EXIT_CONNECTION_ERROR;
			return true;
		}
	}

	let body: Record<string, unknown>;
	try {
		body = buildCommandBody(options.method, paramsJson);
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = EXIT_CONNECTION_ERROR;
		return true;
	}

	const client = new RpcClient(buildClientOptions(options));
	try {
		await client.start();
	} catch (error) {
		console.error(chalk.red(`Failed to start RPC agent: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = EXIT_CONNECTION_ERROR;
		return true;
	}

	try {
		if (options.session) {
			await client.rawSend({ type: "switch_session", sessionPath: options.session });
		}
		const response: RpcResponse = await client.rawSend(body as RpcCommandBody);
		const indent = options.pretty ? 2 : 0;
		process.stdout.write(JSON.stringify(response, null, indent) + "\n");
		process.exitCode = response.success === false ? EXIT_RPC_ERROR : EXIT_OK;
	} catch (error) {
		console.error(chalk.red(`RPC request failed: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = EXIT_CONNECTION_ERROR;
	} finally {
		await client.stop();
	}
	return true;
}
