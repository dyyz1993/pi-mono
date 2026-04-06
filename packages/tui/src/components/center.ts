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

		// First, render children at a large width to get their natural size
		// We use a temporary large width to avoid premature padding
		const tempWidth = 1000; // Large enough for most content
		const allLines: string[] = [];
		for (const child of this.children) {
			const lines = child.render(tempWidth);
			allLines.push(...lines);
		}

		if (allLines.length === 0) {
			return [];
		}

		// Find the maximum visible width among all lines (actual content width)
		let maxContentWidth = 0;
		for (const line of allLines) {
			const lineWidth = visibleWidth(line);
			if (lineWidth > maxContentWidth) {
				maxContentWidth = lineWidth;
			}
		}

		// If content is wider than available width, re-render at actual width
		if (maxContentWidth > width) {
			const wrappedLines: string[] = [];
			for (const child of this.children) {
				const lines = child.render(width);
				wrappedLines.push(...lines);
			}
			return wrappedLines;
		}

		// Pad all lines to the maximum content width to ensure consistent centering
		const paddedLines: string[] = [];
		for (const line of allLines) {
			const lineWidth = visibleWidth(line);
			const rightPadding = Math.max(0, maxContentWidth - lineWidth);
			paddedLines.push(line + " ".repeat(rightPadding));
		}

		// Center each line horizontally within the available width
		// Each line should have exactly 'width' characters
		const centeredLines: string[] = [];
		for (const line of paddedLines) {
			const lineWidth = visibleWidth(line);
			const totalPadding = width - lineWidth;
			const leftPadding = Math.floor(totalPadding / 2);
			const rightPadding = totalPadding - leftPadding;
			centeredLines.push(" ".repeat(Math.max(0, leftPadding)) + line + " ".repeat(Math.max(0, rightPadding)));
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
