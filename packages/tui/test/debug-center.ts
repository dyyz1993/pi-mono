/**
 * Test noPadding option in Text component
 */

import { visibleWidth } from "../src/utils.js";
import { Text } from "../src/components/text.js";
import { Center } from "../src/components/center.js";

console.log("\n=== Testing Text with noPadding=true ===");

// Test 1: Text with noPadding=true
const text = new Text("Hello", 1, 1, undefined, true);
console.log(`Text created with noPadding=true`);
const lines = text.render(40);
console.log(`Rendered ${lines.length} lines at width 40:`);
lines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

// Test 2: Render at large width
const lines2 = text.render(1000);
console.log(`\nRendered ${lines2.length} lines at width 1000:`);
lines2.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

// Test 3: Center with noPadding Text
console.log("\n=== Testing Center with noPadding Text ===");

const center = new Center();
const text2 = new Text("Hello", 1, 1, undefined, true);
center.addChild(text2);

const centeredLines = center.render(40);
console.log(`Centered ${centeredLines.length} lines:`);
centeredLines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

// Check if all lines have width 40
const allWidth40 = centeredLines.every(line => visibleWidth(line) === 40);
console.log(`\nAll lines have width 40: ${allWidth40}`);
