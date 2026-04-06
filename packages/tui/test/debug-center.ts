/**
 * Test noPadding option in Text component with debug
 */

import { visibleWidth } from "../src/utils.js";
import { Text } from "../src/components/text.js";
import { Center } from "../src/components/center.js";

console.log("\n=== Testing Center with noPadding Text (with debug) ===");

// Mock Center.render with debug output
const center = new Center();
const text = new Text("Hello", 1, 1, undefined, true);
center.addChild(text);

const width = 40;
console.log(`Target width: ${width}`);

// Render children at temp width
const tempWidth = 1000;
console.log(`Temp width for first render: ${tempWidth}`);
const allLines: string[] = [];
const lines = text.render(tempWidth);
console.log(`Text rendered ${lines.length} lines at temp width:`);
lines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}, content="${line}"`);
});
allLines.push(...lines);

// Find max content width
let maxContentWidth = 0;
for (const line of allLines) {
	const lineWidth = visibleWidth(line);
	if (lineWidth > maxContentWidth) {
		maxContentWidth = lineWidth;
	}
}
console.log(`Max content width: ${maxContentWidth}`);

// Pad all lines to max content width
const paddedLines: string[] = [];
for (const line of allLines) {
	const lineWidth = visibleWidth(line);
	const rightPadding = Math.max(0, maxContentWidth - lineWidth);
	console.log(`  Padding line "${line}" (width ${lineWidth}) with ${rightPadding} spaces`);
	paddedLines.push(line + " ".repeat(rightPadding));
}
console.log(`Padded lines:`);
paddedLines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}, content="${line}"`);
});

// Center each line
const centeredLines: string[] = [];
for (const line of paddedLines) {
	const lineWidth = visibleWidth(line);
	const leftPadding = Math.floor((width - lineWidth) / 2);
	console.log(`  Centering line (width ${lineWidth}) with ${leftPadding} left padding`);
	centeredLines.push(" ".repeat(Math.max(0, leftPadding)) + line);
}

console.log(`\nFinal centered lines:`);
centeredLines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});
