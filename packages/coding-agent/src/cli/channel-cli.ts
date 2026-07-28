/**
 * `pi channel` — invoke an extension channel method or list known channels.
 *
 * `pi channel call <name> <method> '<params>'` uses
 * `client.channel(name).call(method, params)` to reach an extension's typed
 * channel contract without writing a `ClientChannel<T>` client.
 */

import { readFileSync } from "node:fs";

import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import { RpcClient, type RpcClientOptions } from "../modes/rpc/rpc-client.ts";
import { STATIC_CHANNEL_NAMES } from "./rpc-commands-table.ts";

const EXIT_OK = 0;
const EXIT_RPC_ERROR = 1;
const EXIT_CONNECTION_ERROR = 2;

function printHelp(): void {
	console.log(`${APP_NAME} channel — invoke extension channel methods

${chalk.bold("Usage:")}
  ${APP_NAME} channel call <name> <method> '<params-json>' [options]
  ${APP_NAME} channel list

${chalk.bold("Subcommands:")}
  call <name> <method> '<params>'   Invoke a channel method; print the JSON result
  list                              List statically registered channel names

${chalk.bold("Options:")}
  --timeout <seconds>   Response wait timeout (default: 30)
  --pretty              Pretty-print JSON output (default: compact)
  --remote-ssh <target> Run the RPC child on a remote SSH host
  --provider <name>     Provider for the spawned agent
  --model <id>          Model id for the spawned agent

${chalk.bold("Examples:")}
  ${APP_NAME} channel call todo getTodos '{}'
  ${APP_NAME} channel call todo addTodo '{"text":"ship it"}'
  ${APP_NAME} channel list
`);
}

function printChannelList(): void {
	console.log(chalk.bold("Statically registered channels:"));
	for (const name of STATIC_CHANNEL_NAMES) {
		console.log(`  ${chalk.cyan(name)}`);
	}
	console.log(
		chalk.dim(
			`\n${STATIC_CHANNEL_NAMES.length} channels in the static registry. ` +
				"Channels actually available depend on which extensions loaded at runtime.",
		),
	);
}

interface ChannelCallArgs {
	name: string;
	method: string;
	paramsJson: string;
	timeout?: number;
	pretty?: boolean;
	remoteSsh?: string;
	provider?: string;
	model?: string;
}

function parseChannelCallArgs(args: string[]): { call?: ChannelCallArgs; errors: string[] } {
	const errors: string[] = [];
	const positional: string[] = [];
	const options: Partial<ChannelCallArgs> = {};

	for (let i = 0; i < args.length; i++) {
		const token = args[i]!;
		if (token.startsWith("--timeout")) {
			const inline = token.split("=")[1];
			const raw = inline ?? args[++i];
			const n = Number(raw);
			if (!Number.isFinite(n) || n <= 0) {
				errors.push(`--timeout must be a positive number, got "${raw}".`);
			} else {
				options.timeout = n;
			}
		} else if (token === "--pretty") {
			options.pretty = true;
		} else if (token.startsWith("--remote-ssh")) {
			options.remoteSsh = token.split("=")[1] ?? args[++i];
		} else if (token.startsWith("--provider")) {
			options.provider = token.split("=")[1] ?? args[++i];
		} else if (token.startsWith("--model")) {
			options.model = token.split("=")[1] ?? args[++i];
		} else if (token.startsWith("--")) {
			errors.push(`Unknown option ${token}.`);
		} else {
			positional.push(token);
		}
	}

	if (positional.length < 3) {
		errors.push("channel call requires <name> <method> '<params-json>'.");
		return { errors };
	}
	if (positional.length > 3) {
		errors.push(`Unexpected extra argument "${positional[3]}".`);
		return { errors };
	}

	return {
		call: {
			name: positional[0]!,
			method: positional[1]!,
			paramsJson: positional[2]!,
			timeout: options.timeout,
			pretty: options.pretty,
			remoteSsh: options.remoteSsh,
			provider: options.provider,
			model: options.model,
		},
		errors,
	};
}

function buildClientOptions(call: ChannelCallArgs): RpcClientOptions {
	const clientOptions: RpcClientOptions = {};
	if (call.remoteSsh) {
		clientOptions.remoteSsh = { target: call.remoteSsh, cwd: process.cwd() };
	}
	if (call.provider) clientOptions.provider = call.provider;
	if (call.model) clientOptions.model = call.model;
	return clientOptions;
}

async function runChannelCall(call: ChannelCallArgs): Promise<void> {
	let params: Record<string, unknown>;
	const trimmed = call.paramsJson.trim();
	try {
		const parsed: unknown = trimmed === "" ? {} : JSON.parse(trimmed);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("params must be a JSON object");
		}
		params = parsed as Record<string, unknown>;
	} catch (error) {
		console.error(chalk.red(`Invalid params JSON: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = EXIT_CONNECTION_ERROR;
		return;
	}

	const client = new RpcClient(buildClientOptions(call));
	try {
		await client.start();
	} catch (error) {
		console.error(chalk.red(`Failed to start RPC agent: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = EXIT_CONNECTION_ERROR;
		return;
	}

	try {
		const timeoutMs = (call.timeout ?? 30) * 1000;
		const result: unknown = await client.channel(call.name).call(call.method, params, timeoutMs);
		const indent = call.pretty ? 2 : 0;
		process.stdout.write(JSON.stringify(result, null, indent) + "\n");
		process.exitCode = EXIT_OK;
	} catch (error) {
		console.error(chalk.red(`Channel call failed: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = EXIT_CONNECTION_ERROR;
	} finally {
		await client.stop();
	}
}

export async function runChannelCli(args: string[]): Promise<boolean> {
	if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
		printHelp();
		return true;
	}

	const subcommand = args[0];
	if (subcommand === "list") {
		printChannelList();
		return true;
	}

	if (subcommand === "call") {
		// Allow reading params from a file via `--params-file <path>` for parity
		// with `pi rpc`, then forward the resolved JSON as the 3rd positional.
		const rest = args.slice(1);
		const fileFlagIdx = rest.findIndex((t) => t.startsWith("--params-file"));
		if (fileFlagIdx >= 0) {
			const inline = rest[fileFlagIdx]!.split("=")[1];
			const path = inline ?? rest[fileFlagIdx + 1];
			if (!path) {
				console.error(chalk.red("--params-file requires a path."));
				process.exitCode = EXIT_CONNECTION_ERROR;
				return true;
			}
			const json = readFileSync(path, "utf8");
			rest.splice(fileFlagIdx, inline ? 1 : 2, json);
		}
		const { call, errors } = parseChannelCallArgs(rest);
		if (errors.length > 0) {
			for (const msg of errors) console.error(chalk.red(msg));
			printHelp();
			process.exitCode = EXIT_CONNECTION_ERROR;
			return true;
		}
		if (call) await runChannelCall(call);
		return true;
	}

	console.error(chalk.red(`Unknown channel subcommand: ${subcommand}`));
	printHelp();
	process.exitCode = EXIT_CONNECTION_ERROR;
	return true;
}
