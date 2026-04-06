/**
 * Test noPadding option in Text component
 */

import { visibleWidth } from "../src/utils.js";
import { Text } from "../src/components/text.js";
import { Center } from "../src/components/center.js";

console.log("\n=== Testing Text with noPadding=true ===");
const textNoPad = new Text("Hello", 1, 1, undefined, true);
console.log(`Text created with noPadding=true`);
const lines = textNoPad.render(40);
console.log(`Rendered ${lines.length} lines at width 40:`);
lines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

console.log("\n=== Testing Text with noPadding=true at large width ===");
const linesLarge = textNoPad.render(1000);
console.log(`Rendered ${linesLarge.length} lines at width 1000:`);
linesLarge.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

console.log("\n=== Testing Center with noPadding Text ===");
const center = new Center();
const text = new Text("Hello", 1, 1, undefined, true);
center.addChild(text);
const centeredLines = center.render(40);
console.log(`Centered ${centeredLines.length} lines:`);
centeredLines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});
