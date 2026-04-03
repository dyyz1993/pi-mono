import { smartCleanupEmptyLines } from './src/core/tools/edit-diff.js';

// Test Case 1: Empty line before block close should be preserved
const test1 = `function foo() {
    const a = 1;
    
}
console.log('done');`;

console.log("Test 1: Empty line before block close");
console.log("Input:");
console.log(test1);
console.log("\nOutput:");
console.log(smartCleanupEmptyLines(test1));
console.log("---\n");

// Test Case 2: Empty line after block open should be preserved
const test2 = `function foo() {
    
    const a = 1;
}`;

console.log("Test 2: Empty line after block open");
console.log("Input:");
console.log(test2);
console.log("\nOutput:");
console.log(smartCleanupEmptyLines(test2));
console.log("---\n");

// Test Case 3: Empty line between different indent levels
const test3 = `function foo() {
    const a = 1;

console.log('back to root');`;

console.log("Test 3: Empty line between different indent levels");
console.log("Input:");
console.log(test3);
console.log("\nOutput:");
console.log(smartCleanupEmptyLines(test3));
console.log("---\n");

// Test Case 4: Empty line around comments
const test4 = `const a = 1;

// This is a comment
const b = 2;`;

console.log("Test 4: Empty line around comments");
console.log("Input:");
console.log(test4);
console.log("\nOutput:");
console.log(smartCleanupEmptyLines(test4));
console.log("---\n");

// Test Case 5: Multiple empty lines (should collapse to one)
const test5 = `const a = 1;



const b = 2;`;

console.log("Test 5: Multiple empty lines (should collapse to one)");
console.log("Input:");
console.log(test5);
console.log("\nOutput:");
console.log(smartCleanupEmptyLines(test5));
console.log("---\n");

// Test Case 6: Deletion context - remove artificially created empty line
const test6 = `function foo() {
    const a = 1;
    const b = 2;
    const c = 3;
}`;

console.log("Test 6: Deletion context (deleting line 2)");
console.log("Input:");
console.log(test6);
const afterDeletion = test6.split('\n');
afterDeletion.splice(2, 1); // Delete line 2 (const b = 2)
const result6 = smartCleanupEmptyLines(afterDeletion.join('\n'), {
    deletionLine: 2,
    deletedLines: 1
});
console.log("\nOutput:");
console.log(result6);
console.log("---\n");

// Test Case 7: Deletion should preserve empty line before }
const test7 = `function foo() {
    const a = 1;
    
}`;

console.log("Test 7: Deletion should preserve empty line before }");
console.log("Input:");
console.log(test7);
const result7 = smartCleanupEmptyLines(test7, {
    deletionLine: 2,
    deletedLines: 1
});
console.log("\nOutput:");
console.log(result7);
console.log("---\n");
