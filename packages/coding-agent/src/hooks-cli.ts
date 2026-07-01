import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import chalk from "chalk";
import { APP_NAME } from "./config.ts";
import {
	parseSessionHooksWithDiagnostics,
	type SessionHookEntry,
	type SessionHookParseDiagnostic,
	type SessionHooks,
} from "./core/session-hooks.ts";
import { parseFrontmatter } from "./utils/frontmatter.ts";
import { resolvePath } from "./utils/paths.ts";

export interface HooksValidationResult {
	filePath: string;
	hooks?: SessionHooks;
	diagnostics: SessionHookParseDiagnostic[];
	eventCount: number;
	handlerCount: number;
}

function printHooksHelp(): void {
	console.log(`${chalk.bold("Usage:")}
  ${APP_NAME} hooks validate <path>

Validate pi hooks in a settings JSON file or an agent/skill markdown frontmatter block.

Examples:
  ${APP_NAME} hooks validate .pi/settings.json
  ${APP_NAME} hooks validate .pi/agents/reviewer.md
  ${APP_NAME} hooks validate .pi/skills/review/SKILL.md
`);
}

export async function handleHooksCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "hooks") {
		return false;
	}

	const subcommand = args[1];
	if (!subcommand || subcommand === "-h" || subcommand === "--help") {
		printHooksHelp();
		return true;
	}

	if (subcommand !== "validate") {
		console.error(chalk.red(`Unknown hooks command: ${subcommand}`));
		console.error(chalk.dim(`Usage: ${APP_NAME} hooks validate <path>`));
		process.exitCode = 1;
		return true;
	}

	const rest = args.slice(2);
	if (rest.includes("-h") || rest.includes("--help")) {
		printHooksHelp();
		return true;
	}

	const invalidOption = rest.find((arg) => arg.startsWith("-"));
	if (invalidOption) {
		console.error(chalk.red(`Unknown option ${invalidOption} for "hooks validate".`));
		console.error(chalk.dim(`Usage: ${APP_NAME} hooks validate <path>`));
		process.exitCode = 1;
		return true;
	}

	if (rest.length === 0) {
		console.error(chalk.red("Missing hooks file path."));
		console.error(chalk.dim(`Usage: ${APP_NAME} hooks validate <path>`));
		process.exitCode = 1;
		return true;
	}

	if (rest.length > 1) {
		console.error(chalk.red(`Unexpected argument ${rest[1]}.`));
		console.error(chalk.dim(`Usage: ${APP_NAME} hooks validate <path>`));
		process.exitCode = 1;
		return true;
	}

	const result = validateHooksFile(rest[0]!);
	if (result.diagnostics.length > 0) {
		console.error(chalk.red(`Invalid hooks in ${result.filePath}`));
		for (const diagnostic of result.diagnostics) {
			console.error(chalk.red(`  ${diagnostic.path}: ${diagnostic.message}`));
		}
		process.exitCode = 1;
		return true;
	}

	console.log(
		chalk.green(
			`Hooks valid: ${result.filePath} (${result.eventCount} event${result.eventCount === 1 ? "" : "s"}, ${result.handlerCount} handler${result.handlerCount === 1 ? "" : "s"})`,
		),
	);
	return true;
}

export function validateHooksFile(inputPath: string, cwd = process.cwd()): HooksValidationResult {
	const filePath = resolvePath(inputPath, cwd, { trim: true });
	const diagnostics: SessionHookParseDiagnostic[] = [];

	if (!existsSync(filePath)) {
		return createResult(filePath, undefined, [{ path: inputPath, message: "file does not exist" }]);
	}
	if (!statSync(filePath).isFile()) {
		return createResult(filePath, undefined, [{ path: inputPath, message: "must be a file" }]);
	}

	const content = readFileSync(filePath, "utf-8");
	const ext = extname(filePath).toLowerCase();
	let rawHooks: unknown;
	let pathPrefix = "hooks";

	try {
		if (ext === ".json") {
			const parsed = JSON.parse(content) as unknown;
			rawHooks = isRecord(parsed) && "hooks" in parsed ? parsed.hooks : parsed;
		} else {
			const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
			if (!("hooks" in frontmatter)) {
				diagnostics.push({ path: "frontmatter.hooks", message: "hooks field is missing" });
			}
			rawHooks = frontmatter.hooks;
			pathPrefix = "frontmatter.hooks";
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "failed to parse file";
		return createResult(filePath, undefined, [{ path: inputPath, message }]);
	}

	if (diagnostics.length > 0) {
		return createResult(filePath, undefined, diagnostics);
	}

	const parsed = parseSessionHooksWithDiagnostics(rawHooks, pathPrefix);
	return createResult(filePath, parsed.hooks, parsed.diagnostics);
}

function createResult(
	filePath: string,
	hooks: SessionHooks | undefined,
	diagnostics: SessionHookParseDiagnostic[],
): HooksValidationResult {
	return {
		filePath,
		hooks,
		diagnostics,
		eventCount: hooks ? Object.keys(hooks).length : 0,
		handlerCount: hooks ? countHandlers(hooks) : 0,
	};
}

function countHandlers(hooks: SessionHooks): number {
	let count = 0;
	for (const entries of Object.values(hooks)) {
		for (const entry of entries ?? []) {
			count += isHookGroup(entry) ? entry.hooks.length : 1;
		}
	}
	return count;
}

function isHookGroup(entry: SessionHookEntry): entry is Extract<SessionHookEntry, { hooks: unknown[] }> {
	return "hooks" in entry && Array.isArray(entry.hooks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
