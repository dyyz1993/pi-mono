/**
 * Test visibleWidth function directly
 */

import { visibleWidth } from "../src/utils.js";

console.log("\n=== Testing visibleWidth ===");
console.log(`visibleWidth("Hello"): ${visibleWidth("Hello")}`);
console.log(`visibleWidth(""): ${visibleWidth("")}`);
console.log(`visibleWidth("\\x1b[31mRed\\x1b[0m"): ${visibleWidth("\x1b[31mRed\x1b[0m")}`);
console.log(`visibleWidth("测试"): ${visibleWidth("测试")}`);
console.log(`visibleWidth("😀"): ${visibleWidth("😀")}`);

console.log("\n=== Testing Text component ===");
import { Text } from "../src/components/text.js";

const text = new Text("Hello World");
console.log(`Text created: "Hello World"`);
const lines = text.render(40);
console.log(`Rendered ${lines.length} lines at width 40:`);
lines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

console.log("\n=== Testing Text component at large width ===");
const linesLarge = text.render(1000);
console.log(`Rendered ${linesLarge.length} lines at width 1000:`);
linesLarge.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	if (i === 1) {
		console.log(`    First 80 chars: "${line.substring(0, 80)}"`);
	}
});

console.log("\n=== Testing Text with center ===");
import { Center } from "../src/components/center.js";

const center = new Center();
const text2 = new Text("Hello");
center.addChild(text2);
const centeredLines = center.render(40);
console.log(`Centered ${centeredLines.length} lines:`);
centeredLines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
});

console.log("\n=== Testing plain text centering ===");
const plainText = "Hello";
const plainWidth = visibleWidth(plainText);
console.log(`Plain text: "${plainText}", width=${plainWidth}`);
const leftPad = Math.floor((40 - plainWidth) / 2);
const centered = " ".repeat(leftPad) + plainText;
console.log(`Centered: "${centered}", visibleWidth=${visibleWidth(centered)}`);
