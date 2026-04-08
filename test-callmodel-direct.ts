/**
 * Direct test script for callModel functionality
 * Run with: npx tsx test-callmodel-direct.ts
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
	console.log("Testing callModel functionality...\n");

	const extensionsDir = join(__dirname, ".pi/extensions");
	const testFile = join(extensionsDir, "callmodel-test.ts");

	console.log("Checking if test extension exists:", existsSync(testFile));

	const codingAgentDir = join(__dirname, "packages/coding-agent");
	const testExtension = join(codingAgentDir, "examples/extensions/callmodel-test.ts");
	console.log("Checking if test extension exists:", existsSync(testExtension));

	const sourceFile = join(codingAgentDir, "src/core/agent-session.ts");
	console.log("Checking if agent-session.ts exists:", existsSync(sourceFile));

	const runnerFile = join(codingAgentDir, "src/core/extensions/runner.ts");
	console.log("Checking if runner.ts exists:", existsSync(runnerFile));

	const typesFile = join(codingAgentDir, "src/core/extensions/types.ts");
	console.log("Checking if types.ts exists:", existsSync(typesFile));

	console.log("\nDone. Files exist, but actual execution requires pi runtime.");
	console.log("\nTo run in pi:");
	console.log("  1. Copy callmodel-test.ts to .pi/extensions/");
	console.log("  2. Run: ./pi-test.sh");
	console.log("  3. In pi, run: /test-callmodel");
}

main().catch(console.error);
