/**
 * Top-level dispatch for the `pi rpc`, `pi channel`, and `pi subscribe`
 * subcommands. Mirrors the positional-subcommand pattern used by
 * `handleHooksCommand` / `handleConfigCommand` / `handlePackageCommand`:
 * inspect `args[0]`, route to the matching handler, and return `true` so the
 * caller (`main.ts`) short-circuits before flag parsing.
 */

import { APP_NAME } from "../config.ts";
import { runChannelCli } from "./channel-cli.ts";
import { runRpcCli } from "./rpc-cli.ts";
import { runSubscribeCli } from "./subscribe-cli.ts";

const SUBCOMMANDS = ["rpc", "channel", "subscribe"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string | undefined): value is Subcommand {
	return value !== undefined && (SUBCOMMANDS as readonly string[]).includes(value);
}

function printHelp(): void {
	console.log(`${APP_NAME} rpc          Invoke an RPC method and print the JSON response
${APP_NAME} channel      Invoke an extension channel method or list channels
${APP_NAME} subscribe    Stream session events as JSONL until Ctrl+C / timeout

Learn more:
  ${APP_NAME} rpc --help
  ${APP_NAME} channel --help
  ${APP_NAME} subscribe --help
`);
}

/**
 * Returns `true` when the first positional token is one of the RPC-family
 * subcommands and the request has been fully handled (the process may have
 * already exited). Returns `false` to let `main()` continue to flag parsing.
 */
export async function handleRpcCommand(args: string[]): Promise<boolean> {
	if (!isSubcommand(args[0])) {
		return false;
	}

	const subcommand = args[0] as Subcommand;
	const rest = args.slice(1);

	if (rest.includes("-h") || rest.includes("--help")) {
		printHelp();
		return true;
	}

	switch (subcommand) {
		case "rpc":
			await runRpcCli(rest);
			return true;
		case "channel":
			await runChannelCli(rest);
			return true;
		case "subscribe":
			await runSubscribeCli(rest);
			return true;
	}
}
