import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");
const extPath = join(__dirname, "..", "examples", "extensions", "file-snapshot.ts");

const dir = `/tmp/pi-snap-debug-${Date.now()}`;
mkdirSync(dir, { recursive: true });

const client = new RpcClient({ cliPath, cwd: dir, args: ["--no-extensions", "-e", extPath, "--no-session"] });
await client.start();

await client.promptAndWait("Create hello.txt with content v1. Use write tool.", undefined, 120_000);
await client.promptAndWait("Overwrite hello.txt with content v2. Use write tool.", undefined, 120_000);
await client.promptAndWait("Delete hello.txt using bash rm hello.txt. Do not recreate.", undefined, 120_000);

const tree = await client.getTree();
for (const e of tree) {
	const label = (e as any).label ?? (e as any).customType ?? "-";
	const data = (e as any).data ? JSON.stringify((e as any).data).substring(0, 150) : "";
	console.log(e.id.substring(0, 6), e.type, label, data);
}

console.log("\nFiles on disk:", readdirSync(dir));

await client.stop();
rmSync(dir, { recursive: true, force: true });
