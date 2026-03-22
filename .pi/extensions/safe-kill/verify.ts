/**
 * Verification script to test pattern matching
 * Run with: npx tsx verify.ts
 */

const DANGEROUS_PATTERNS = [
	{
		pattern: /pkill\s+-f\s+["']([^"']+)["']/,
		command: "pkill -f <pattern>",
		description: "通过进程名称匹配杀死进程",
	},
	{
		pattern: /pkill\s+-f\s+([^\s"']+)/,
		command: "pkill -f <pattern>",
		description: "通过进程名称匹配杀死进程（无引号）",
	},
	{
		pattern: /killall\s+(\w+)/,
		command: "killall <name>",
		description: "通过进程名杀死所有匹配进程",
	},
];

function testCommand(command: string): { blocked: boolean; target?: string; reason?: string } {
	for (const { pattern, command: cmdPattern, description } of DANGEROUS_PATTERNS) {
		const match = command.match(pattern);
		if (match) {
			return {
				blocked: true,
				target: match[1],
				reason: `🚫 禁止使用 ${cmdPattern} 杀死进程`,
			};
		}
	}
	return { blocked: false };
}

// Test cases
const testCases = [
	// Should block
	{ cmd: 'pkill -f "vite"', shouldBlock: true },
	{ cmd: "pkill -f 'vite'", shouldBlock: true },
	{ cmd: "pkill -f vite", shouldBlock: true },
	{ cmd: 'pkill -f "npm run dev"', shouldBlock: true },
	{ cmd: "killall vite", shouldBlock: true },
	{ cmd: "killall node", shouldBlock: true },
	
	// Should allow
	{ cmd: "kill 12345", shouldBlock: false },
	{ cmd: "kill -9 12345", shouldBlock: false },
	{ cmd: "ps aux | grep vite", shouldBlock: false },
	{ cmd: "pgrep -f vite", shouldBlock: false },
	{ cmd: "lsof -i :5173", shouldBlock: false },
];

console.log("=".repeat(60));
console.log("Safe Kill Extension - Pattern Verification");
console.log("=".repeat(60));
console.log();

let passed = 0;
let failed = 0;

for (const { cmd, shouldBlock } of testCases) {
	const result = testCommand(cmd);
	const success = result.blocked === shouldBlock;
	
	if (success) {
		passed++;
		console.log(`✓ ${cmd}`);
		if (result.blocked) {
			console.log(`  → Blocked: ${result.reason}`);
			console.log(`  → Target: ${result.target}`);
		} else {
			console.log(`  → Allowed`);
		}
	} else {
		failed++;
		console.log(`✗ ${cmd}`);
		console.log(`  Expected: ${shouldBlock ? "BLOCKED" : "ALLOWED"}`);
		console.log(`  Got: ${result.blocked ? "BLOCKED" : "ALLOWED"}`);
	}
	console.log();
}

console.log("=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));

if (failed > 0) {
	process.exit(1);
}
