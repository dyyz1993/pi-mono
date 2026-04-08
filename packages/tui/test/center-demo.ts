/**
 * Center alignment demo using tui.ts
 * Demonstrates horizontal and vertical centering
 */

import chalk from "chalk";
import { Center } from "../src/components/center.js";
import { Editor } from "../src/components/editor.js";
import { Markdown } from "../src/components/markdown.js";
import { Text } from "../src/components/text.js";
import { ProcessTerminal } from "../src/terminal.js";
import { TUI } from "../src/tui.js";
import { defaultEditorTheme, defaultMarkdownTheme } from "./test-themes.js";

// Create terminal
const terminal = new ProcessTerminal();

// Create TUI
const tui = new TUI(terminal);

// Create a container for the main content
const mainContainer = new Center();

// Create title
const title = new Text(
	chalk.bold.cyan("╔══════════════════════════════════════════╗\n") +
		chalk.bold.cyan("║") +
		chalk.bold.yellow("     Center Alignment Demo     ") +
		chalk.bold.cyan("║\n") +
		chalk.bold.cyan("╚══════════════════════════════════════════╝\n\n"),
);

// Create welcome message
const welcome = new Markdown(
	"## Welcome!\n\nThis demo shows how to use the **Center** component to center content horizontally and vertically.\n\n" +
		"Type some text and press Enter to see it centered below.",
	1,
	1,
	defaultMarkdownTheme,
);

// Create instructions
const instructions = new Text(
	"\n" +
		chalk.dim("Commands:") +
		"\n" +
		chalk.dim("  /clear") +
		" - Clear all messages\n" +
		chalk.dim("  Ctrl+C") +
		" - Exit\n\n",
);

// Add initial content
mainContainer.addChild(title);
mainContainer.addChild(welcome);
mainContainer.addChild(instructions);

// Create editor
const editor = new Editor(tui, defaultEditorTheme);

// Track messages
const messages: Markdown[] = [];

// Handle message submission
editor.onSubmit = (value: string) => {
	const trimmed = value.trim();

	if (trimmed === "/clear") {
		// Remove all messages
		for (const msg of messages) {
			mainContainer.removeChild(msg);
		}
		messages.length = 0;
		tui.requestRender();
		return;
	}

	if (trimmed) {
		// Add user message
		const userMessage = new Markdown(`**You:** ${trimmed}`, 1, 1, {
			...defaultMarkdownTheme,
			background: "transparent",
		});
		messages.push(userMessage);
		mainContainer.addChild(userMessage);

		// Add bot response
		const responses = [
			"Thanks for your message! 🎉",
			"Interesting thought! 🤔",
			"Got it! ✨",
			"That's great! 👍",
			"Nice! 🌟",
		];
		const randomResponse = responses[Math.floor(Math.random() * responses.length)];
		const botMessage = new Markdown(`**Bot:** ${randomResponse}`, 1, 1, {
			...defaultMarkdownTheme,
			background: "transparent",
		});
		messages.push(botMessage);
		mainContainer.addChild(botMessage);

		tui.requestRender();
	}
};

// Add components to TUI
tui.addChild(mainContainer);
tui.addChild(editor);

// Focus the editor
tui.setFocus(editor);

// Start the TUI
tui.start();
