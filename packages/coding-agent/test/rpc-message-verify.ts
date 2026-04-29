import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");
const extPath = join(__dirname, "..", "examples", "extensions", "file-snapshot.ts");

const dir = `/tmp/pi-msg-verify-${Date.now()}`;
mkdirSync(dir, { recursive: true });

const client = new RpcClient({ cliPath, cwd: dir, args: ["--no-extensions", "-e", extPath, "--no-session"] });
await client.start();

// R1: user + assistant
console.log("=== Round 1 ===");
const ev1 = await client.promptAndWait("Say exactly: R1 done", undefined, 120_000);
const msgs1 = await client.getMessages();
console.log("Messages after R1:");
for (const m of msgs1) {
	console.log(
		`  role=${m.role} content=${(m.content as any)?.[0]?.text ?? JSON.stringify(m.content)?.substring(0, 60)}`,
	);
}

// R2: user + assistant
console.log("\n=== Round 2 ===");
const ev2 = await client.promptAndWait("Say exactly: R2 done", undefined, 120_000);
const msgs2 = await client.getMessages();
console.log("Messages after R2:");
for (const m of msgs2) {
	console.log(
		`  role=${m.role} content=${(m.content as any)?.[0]?.text ?? JSON.stringify(m.content)?.substring(0, 60)}`,
	);
}

// R3: user + assistant
console.log("\n=== Round 3 ===");
const ev3 = await client.promptAndWait("Say exactly: R3 done", undefined, 120_000);
const msgs3 = await client.getMessages();
console.log("Messages after R3:");
for (const m of msgs3) {
	console.log(
		`  role=${m.role} content=${(m.content as any)?.[0]?.text ?? JSON.stringify(m.content)?.substring(0, 60)}`,
	);
}

// Get tree
const tree = await client.getTree();
console.log("\n=== Tree ===");
for (const e of tree) {
	console.log(`  ${e.id.substring(0, 6)} type=${e.type} label=${(e as any).label ?? "-"}`);
}

// Rollback message: go back 1 round (to R2's leaf)
// Find R2's assistant entry (2nd assistant message)
const assistantEntries = tree.filter((e: any) => e.type === "message" && e.label === "assistant");
const r2Assistant = assistantEntries[1]; // 0=R1, 1=R2
if (!r2Assistant) {
	console.log("R2 assistant not found");
	process.exit(1);
}

// To rollback 1 message, navigate to the entry BEFORE R3's user message
// That means navigate to R2's assistant entry
console.log(`\n=== Rollback to R2 assistant: ${r2Assistant.id.substring(0, 8)} ===`);
await client.navigateTree(r2Assistant.id);
const msgsAfterRollback = await client.getMessages();
console.log("Messages after rollback (should be R1 + R2):");
for (const m of msgsAfterRollback) {
	console.log(
		`  role=${m.role} content=${(m.content as any)?.[0]?.text ?? JSON.stringify(m.content)?.substring(0, 60)}`,
	);
}

// Check: all user messages present?
const userMsgs = msgsAfterRollback.filter((m: any) => m.role === "user");
const assistantMsgs = msgsAfterRollback.filter((m: any) => m.role === "assistant");
console.log(`\nUser messages: ${userMsgs.length}, Assistant messages: ${assistantMsgs.length}`);
console.log(`Expected: User=2, Assistant=2`);
console.log(`Result: ${userMsgs.length === 2 && assistantMsgs.length === 2 ? "PASS" : "FAIL"}`);

// Rollback ALL: go back to root
const root = tree.find((e: any) => !e.parentId);
console.log(`\n=== Rollback ALL to root: ${root?.id.substring(0, 8)} ===`);
await client.navigateTree(root!.id);
const msgsAfterAllRollback = await client.getMessages();
console.log("Messages after rollback ALL:");
for (const m of msgsAfterAllRollback) {
	console.log(
		`  role=${m.role} content=${(m.content as any)?.[0]?.text ?? JSON.stringify(m.content)?.substring(0, 60)}`,
	);
}
console.log(`Messages count: ${msgsAfterAllRollback.length}, Expected: 0`);
console.log(`Result: ${msgsAfterAllRollback.length === 0 ? "PASS" : "FAIL"}`);

await client.stop();
rmSync(dir, { recursive: true, force: true });
