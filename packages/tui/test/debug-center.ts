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
console.log(`Rendered ${lines.length} lines:`);
lines.forEach((line, i) => {
	console.log(`  Line ${i}: visibleWidth=${visibleWidth(line)}`);
	console.log(`    Content: "${line}"`);
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
