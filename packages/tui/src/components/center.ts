import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

/**
 * Center component - centers its children horizontally (and optionally vertically)
 * 
 * This component wraps other components and centers their content within the available width.
 */
export class Center implements Component {
	children: Component[] = [];
	private vertical: boolean;

	constructor(vertical = false) {
		this.vertical = vertical;
	}

	addChild(component: Component): void {
		this.children.push(component);
	}

	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1) {
			this.children.splice(index, 1);
		}
	}

	clear(): void {
		this.children = [];
	}

	invalidate(): void {
		for (const child of this.children) {
			child.invalidate?.();
		}
	}

	render(width: number): string[] {
		if (this.children.length === 0) {
			return [];
		}

		// Render all children first
		const allLines: string[] = [];
		for (const child of this.children) {
			const lines = child.render(width);
			allLines.push(...lines);
		}

		if (allLines.length === 0) {
			return [];
		}

		// Find the maximum visible width among all lines
		let maxLineWidth = 0;
		for (const line of allLines) {
			const lineWidth = visibleWidth(line);
			if (lineWidth > maxLineWidth) {
				maxLineWidth = lineWidth;
			}
		}

		// Center each line horizontally
		const centeredLines: string[] = [];
		for (const line of allLines) {
			const lineWidth = visibleWidth(line);
			const leftPadding = Math.floor((width - lineWidth) / 2);
			centeredLines.push(" ".repeat(Math.max(0, leftPadding)) + line);
		}

		// If vertical centering is enabled, add top/bottom padding
		if (this.vertical && centeredLines.length < process.stdout.rows) {
			const totalPadding = process.stdout.rows - centeredLines.length;
			const topPadding = Math.floor(totalPadding / 2);
			const emptyLine = " ".repeat(width);
			const topLines = Array(topPadding).fill(emptyLine);
			const bottomLines = Array(totalPadding - topPadding).fill(emptyLine);
			return [...topLines, ...centeredLines, ...bottomLines];
		}

		return centeredLines;
	}
}
