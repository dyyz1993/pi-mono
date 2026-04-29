import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(__dirname, "..", "examples", "extensions", "file-snapshot.ts");
const cliPath = join(__dirname, "..", "dist", "cli.js");

function listFiles(dir: string): string[] {
	try {
		return readdirSync(dir).filter((f) => !f.startsWith("."));
	} catch {
		return [];
	}
}

function readFile2(dir: string, name: string): string | null {
	const p = join(dir, name);
	if (!existsSync(p)) return null;
	return readFileSync(p, "utf-8");
}

function snapshot(dir: string): Record<string, string | null> {
	const files = listFiles(dir);
	const result: Record<string, string | null> = {};
	for (const f of files) result[f] = readFile2(dir, f);
	return result;
}

async function makeClient(dir: string): Promise<RpcClient> {
	mkdirSync(dir, { recursive: true });
	const client = new RpcClient({
		cliPath,
		cwd: dir,
		args: ["--no-extensions", "-e", extensionPath, "--no-session"],
	});
	await client.start();
	return client;
}

async function main() {
	console.log("=".repeat(60));
	console.log("ROLLBACK MATRIX VERIFICATION");
	console.log(
		"Timeline: T0[empty] -> T1[hello=v1] -> T2[hello=v2] -> T3[hello deleted] -> T4[hello=v3 + extra=extra]",
	);
	console.log("=".repeat(60));

	// --- Case A: T4 -> rollback 1 round -> T3 ---
	{
		console.log("\n--- Case A: T4 -> 回滚1轮 -> T3 ---");
		const dir = `/tmp/pi-rb-A-${Date.now()}`;
		const client = await makeClient(dir);

		await client.promptAndWait("Create hello.txt with content 'v1'. Use write tool only.", undefined, 120_000);
		console.log("  T1:", snapshot(dir));

		await client.promptAndWait("Overwrite hello.txt with content 'v2'. Use write tool only.", undefined, 120_000);
		console.log("  T2:", snapshot(dir));

		await client.promptAndWait("Delete hello.txt using bash: rm hello.txt. Do not recreate it.", undefined, 120_000);
		console.log("  T3:", snapshot(dir));

		await client.promptAndWait(
			"Create hello.txt with content 'v3' and create extra.txt with content 'extra'. Use write tool.",
			undefined,
			120_000,
		);
		console.log("  T4:", snapshot(dir));

		const tree = await client.getTree();
		const snaps = tree.filter((e: any) => e.type === "custom");
		console.log(
			"  Snapshots:",
			snaps.length,
			snaps.map((s: any) => s.id.substring(0, 6)),
		);

		// Rollback to T3's snapshot (index 2)
		const target = snaps[2];
		if (target) {
			console.log("  -> Rolling back to T3 snapshot:", target.id.substring(0, 8));
			await client.navigateTree(target.id);
			console.log("  After rollback:", snapshot(dir));
		} else {
			console.log("  SKIP: T3 snapshot not found");
			for (const e of tree) {
				console.log(`    ${e.id.substring(0, 6)} type=${e.type} label=${(e as any).label ?? "-"}`);
			}
		}

		await client.stop();
		rmSync(dir, { recursive: true, force: true });
	}

	// --- Case B: T4 -> rollback 2 rounds -> T2 ---
	{
		console.log("\n--- Case B: T4 -> 回滚2轮 -> T2 ---");
		const dir = `/tmp/pi-rb-B-${Date.now()}`;
		const client = await makeClient(dir);

		await client.promptAndWait("Create hello.txt with content 'v1'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Overwrite hello.txt with content 'v2'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Delete hello.txt using bash: rm hello.txt. Do not recreate it.", undefined, 120_000);
		await client.promptAndWait(
			"Create hello.txt with content 'v3' and extra.txt with content 'extra'. Use write tool.",
			undefined,
			120_000,
		);
		console.log("  T4:", snapshot(dir));

		const tree = await client.getTree();
		const snaps = tree.filter((e: any) => e.type === "custom");
		const target = snaps[1]; // T2's snapshot
		console.log("  -> Rolling back to T2 snapshot:", target?.id.substring(0, 8));
		if (target) {
			await client.navigateTree(target.id);
			console.log("  After rollback:", snapshot(dir));
		}

		await client.stop();
		rmSync(dir, { recursive: true, force: true });
	}

	// --- Case C: T4 -> rollback ALL -> T0 ---
	{
		console.log("\n--- Case C: T4 -> 回滚全部 -> T0 ---");
		const dir = `/tmp/pi-rb-C-${Date.now()}`;
		const client = await makeClient(dir);

		await client.promptAndWait("Create hello.txt with content 'v1'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Overwrite hello.txt with content 'v2'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Delete hello.txt using bash: rm hello.txt. Do not recreate it.", undefined, 120_000);
		await client.promptAndWait(
			"Create hello.txt with content 'v3' and extra.txt with content 'extra'. Use write tool.",
			undefined,
			120_000,
		);
		console.log("  T4:", snapshot(dir));

		const tree = await client.getTree();
		const root = tree.find((e: any) => !e.parentId);
		console.log("  -> Rolling back to root:", root?.id.substring(0, 8));
		if (root) {
			await client.navigateTree(root.id);
			console.log("  After rollback ALL:", snapshot(dir));
		}

		await client.stop();
		rmSync(dir, { recursive: true, force: true });
	}

	// --- Case D: T4 -> rollback msg to T2 -> rollback ALL to T0 ---
	{
		console.log("\n--- Case D: T4 -> 回滚消息到T2 -> 回滚全部到T0 ---");
		const dir = `/tmp/pi-rb-D-${Date.now()}`;
		const client = await makeClient(dir);

		await client.promptAndWait("Create hello.txt with content 'v1'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Overwrite hello.txt with content 'v2'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Delete hello.txt using bash: rm hello.txt. Do not recreate it.", undefined, 120_000);
		await client.promptAndWait(
			"Create hello.txt with content 'v3' and extra.txt with content 'extra'. Use write tool.",
			undefined,
			120_000,
		);
		console.log("  T4:", snapshot(dir));

		// Step 1: Rollback to T2
		const tree1 = await client.getTree();
		const snaps1 = tree1.filter((e: any) => e.type === "custom");
		const t2 = snaps1[1];
		console.log("  Step1: Rollback to T2:", t2?.id.substring(0, 8));
		if (t2) {
			await client.navigateTree(t2.id);
			console.log("  After step1:", snapshot(dir));
		}

		// Step 2: Rollback ALL
		const tree2 = await client.getTree();
		const root = tree2.find((e: any) => !e.parentId);
		console.log("  Step2: Rollback ALL:", root?.id.substring(0, 8));
		if (root) {
			await client.navigateTree(root.id);
			console.log("  After step2 (ALL):", snapshot(dir));
		}

		await client.stop();
		rmSync(dir, { recursive: true, force: true });
	}

	// --- Case E: T4 -> rollback to T2 -> continue -> rollback again ---
	{
		console.log("\n--- Case E: T4 -> 回滚到T2 -> 继续对话 -> 再回滚 ---");
		const dir = `/tmp/pi-rb-E-${Date.now()}`;
		const client = await makeClient(dir);

		await client.promptAndWait("Create hello.txt with content 'v1'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Overwrite hello.txt with content 'v2'. Use write tool only.", undefined, 120_000);
		await client.promptAndWait("Delete hello.txt using bash: rm hello.txt. Do not recreate it.", undefined, 120_000);
		await client.promptAndWait(
			"Create hello.txt with content 'v3' and extra.txt with content 'extra'. Use write tool.",
			undefined,
			120_000,
		);
		console.log("  T4:", snapshot(dir));

		// Rollback to T2
		const tree1 = await client.getTree();
		const snaps1 = tree1.filter((e: any) => e.type === "custom");
		const t2 = snaps1[1];
		console.log("  -> Rollback to T2:", t2?.id.substring(0, 8));
		if (t2) {
			await client.navigateTree(t2.id);
			console.log("  After rollback:", snapshot(dir));
		}

		// Continue: T5
		await client.promptAndWait(
			"Create newfile.txt with content 'after-rollback'. Use write tool.",
			undefined,
			120_000,
		);
		console.log("  T5 (after rollback + new msg):", snapshot(dir));

		// Rollback to T1
		const tree2 = await client.getTree();
		const snaps2 = tree2.filter((e: any) => e.type === "custom");
		const t1 = snaps2[0];
		console.log("  -> Rollback to T1:", t1?.id.substring(0, 8));
		if (t1) {
			await client.navigateTree(t1.id);
			console.log("  After 2nd rollback:", snapshot(dir));
		}

		await client.stop();
		rmSync(dir, { recursive: true, force: true });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
