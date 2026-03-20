/**
 * Bash Manager Plugin Demo
 *
 * This example demonstrates how to use the BashManager plugin to:
 * - Track bash processes with their associated agents
 * - Monitor status, runtime, and countdown
 * - Subscribe to events
 * - Kill processes
 */

import {
	BashManager,
	getGlobalBashManager,
	type BashManagerEvent,
} from "../src/core/bash-manager.js";

// Create a new BashManager instance
const manager = new BashManager();

// Or use the global singleton
const globalManager = getGlobalBashManager();

// Subscribe to events
const unsubscribe = manager.subscribe((event: BashManagerEvent) => {
	switch (event.type) {
		case "bash_start":
			console.log(
				`[BashManager] Process started: ${event.bash.id} (agent: ${event.bash.agentId})`,
			);
			break;
		case "bash_update": {
			const runtime = manager.getRuntime(event.bash.id);
			const countdown = manager.getCountdownRemaining(event.bash.id);
			console.log(
				`[BashManager] Process update: ${event.bash.id}, runtime: ${runtime}s` +
					(countdown !== undefined ? `, countdown: ${countdown}s` : ""),
			);
			break;
		}
		case "bash_end":
			console.log(
				`[BashManager] Process ended: ${event.bash.id}, exitCode: ${event.bash.exitCode}`,
			);
			break;
		case "bash_killed":
			console.log(`[BashManager] Process killed: ${event.bash.id}`);
			break;
		case "bash_error":
			console.log(
				`[BashManager] Process error: ${event.bash.id}, error: ${event.error.message}`,
			);
			break;
	}
});

// Execute a bash command with an agent ID
const bashId = manager.execute({
	agentId: "agent-001",
	command: "echo 'Hello from bash!' && sleep 2 && echo 'Done'",
	countdown: 30, // 30 second timeout
	onChunk: (chunk: string) => {
		process.stdout.write(chunk);
	},
	onExit: (exitCode: number | undefined) => {
		console.log(`\nProcess exited with code: ${exitCode}`);
	},
});

console.log(`Started bash process: ${bashId}`);

// After some time, kill the process (optional)
setTimeout(() => {
	console.log("\nKilling process...");
	manager.kill(bashId);

	// Check active processes
	console.log("\nActive processes:", manager.getActive().length);

	// Get all processes
	console.log("All processes:", manager.getAll().map((b) => b.id));

	// Clean up
	unsubscribe();
	manager.destroy();
	process.exit(0);
}, 5000);
