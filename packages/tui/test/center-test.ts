/**
 * Simple test for Center component
 */

import chalk from "chalk";
import { Center } from "../src/components/center.js";
import { Text } from "../src/components/text.js";

// Test 1: Single line centering
console.log("\n=== Test 1: Single line centering ===");
const center1 = new Center();
center1.addChild(new Text("Hello World"));
const lines1 = center1.render(40);
console.log(`Width: 40, Line: "${lines1[0]}"`);
console.log(`Expected padding: ~14 spaces on the left`);
console.log(`Actual: "${lines1[0]}"`);

// Test 2: Multiple lines
console.log("\n=== Test 2: Multiple lines ===");
const center2 = new Center();
center2.addChild(new Text("Line 1\nLine 2\nLine 3"));
const lines2 = center2.render(40);
console.log(`Lines (${lines2.length}):`);
lines2.forEach((line, i) => console.log(`  ${i}: "${line}"`));

// Test 3: Different widths
console.log("\n=== Test 3: Different widths ===");
const center3 = new Center();
center3.addChild(new Text("Test"));
for (const width of [20, 40, 60, 80]) {
	const lines = center3.render(width);
	console.log(`Width ${width}: "${lines[0]}"`);
}

// Test 4: With ANSI codes
console.log("\n=== Test 4: With ANSI codes ===");
const center4 = new Center();
center4.addChild(new Text(chalk.red("Red") + " " + chalk.blue("Blue")));
const lines4 = center4.render(40);
console.log(`Line: "${lines4[0]}"`);

// Test 5: Vertical centering
console.log("\n=== Test 5: Vertical centering ===");
const center5 = new Center(true);
center5.addChild(new Text("Vertically centered"));
console.log(`Terminal rows: ${process.stdout.rows}`);
const lines5 = center5.render(40);
console.log(`Total lines: ${lines5.length}`);
console.log(`Should have padding above and below`);
