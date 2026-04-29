import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(tmpdir(), `pi-rollback-diag-${Date.now()}`);
mkdirSync(projectDir, { recursive: true });

console.log("Project dir:", projectDir);

const extensionPath = join(__dirname, "..", "examples", "extensions", "file-snapshot.ts");
const cliPath = join(__dirname, "..", "dist", "cli.js");

const client = new RpcClient({
	cliPath,
	cwd: projectDir,
	args: ["--no-extensions", "-e", extensionPath, "--no-session"],
});

function listFiles() {
	try {
		return readdirSync(projectDir).filter((f) => !f.startsWith("."));
	} catch {
		return [];
	}
}

async function main() {
	await client.start();
	console.log("Client started");

	// Round 1
	console.log("\n--- Round 1: Create alpha.txt ---");
	const events1 = await client.promptAndWait(
		"Create a file called alpha.txt with content 'aaa'. Use the write tool.",
		undefined,
		120_000,
	);
	console.log("Events count:", events1.length);
	console.log("Files after R1:", listFiles());
	if (existsSync(join(projectDir, "alpha.txt"))) {
		console.log("alpha.txt content:", readFileSync(join(projectDir, "alpha.txt"), "utf-8"));
	} else {
		console.log("alpha.txt NOT FOUND");
		const toolCalls = events1.filter(
			(e) =>
				(e as any).type === "tool_call" ||
				((e as any).message?.content as any[])?.some((c: any) => c.type === "toolCall"),
		);
		console.log("Tool call events:", toolCalls.length);
		for (const e of events1) {
			if ((e as any).type === "tool_execution_start") {
				console.log(`  Tool: ${(e as any).toolName}`, JSON.stringify((e as any).args).substring(0, 200));
			}
			if ((e as any).type === "tool_execution_update") {
				const r = (e as any).partialResult;
				if (r) console.log(`  Tool result preview:`, JSON.stringify(r).substring(0, 200));
			}
		}
	}

	// Round 2
	console.log("\n--- Round 2: Create beta.txt ---");
	const events2 = await client.promptAndWait(
		"Create a file called beta.txt with content 'bbb'. Use the write tool.",
		undefined,
		120_000,
	);
	console.log("Events count:", events2.length);
	console.log("Files after R2:", listFiles());
	if (existsSync(join(projectDir, "beta.txt"))) {
		console.log("beta.txt content:", readFileSync(join(projectDir, "beta.txt"), "utf-8"));
	} else {
		console.log("beta.txt NOT FOUND");
		for (const e of events2) {
			if ((e as any).type === "tool_execution_start") {
				console.log(`  Tool: ${(e as any).toolName}`, JSON.stringify((e as any).args).substring(0, 200));
			}
		}
	}

	// Get tree
	const tree = await client.getTree();
	console.log("\n--- Tree entries ---");
	for (const e of tree) {
		console.log(
			`  ${e.id.substring(0, 8)} type=${e.type} label=${(e as any).label ?? "-"} parentId=${(e.parentId ?? "null").substring(0, 8)}`,
		);
	}

	// Find R1's step-snapshot entry (this is what we want to rollback to)
	const customEntries = tree.filter((e) => e.type === "custom");
	for (const c of customEntries) {
		console.log(
			`  custom entry: id=${c.id.substring(0, 8)} customType=${(c as any).customType} data=${JSON.stringify((c as any).data ?? {}).substring(0, 100)}`,
		);
	}
	// Use the R1 assistant's last entry (step-snapshot) as rollback target
	// Or just use the step-snapshot entry
	const stepSnapshot = customEntries[0]; // first snapshot = R1
	const targetId = stepSnapshot?.id;
	console.log("\nRollback target (R1 step-snapshot):", targetId);

	// Rollback
	console.log("\n--- Rollback to R1 ---");
	const navResult = await client.navigateTree(targetId!);
	console.log("Nav result:", JSON.stringify(navResult));
	const stderr = client.getStderr();
	const last500 = stderr.substring(Math.max(0, stderr.length - 500));
	console.log("Pi stderr (last 500):", last500);

	// Check events during rollback
	console.log("\nChecking for file-snapshot custom entries in tree...");
	const tree2 = await client.getTree();
	const customs = tree2.filter((e) => e.type === "custom");
	for (const c of customs) {
		console.log(`  custom: ${(c as any).customType}`, JSON.stringify((c as any).data ?? {}).substring(0, 300));
	}

	console.log("Files after rollback:", listFiles());

	if (existsSync(join(projectDir, "alpha.txt"))) {
		console.log("alpha.txt content:", readFileSync(join(projectDir, "alpha.txt"), "utf-8"));
	} else {
		console.log("alpha.txt NOT FOUND after rollback");
	}
	console.log("beta.txt exists:", existsSync(join(projectDir, "beta.txt")));

	await client.stop();
	rmSync(projectDir, { recursive: true, force: true });
}

main().catch((e) => {
	console.error(e);
	client.stop().finally(() => process.exit(1));
});
