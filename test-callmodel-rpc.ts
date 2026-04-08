/**
 * Test callModel via RPC mode
 * This creates a test that can be run via pi RPC
 */

import * as fs from "node:fs";
import * as path from "node:path";

const script = `
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const extractText = (content: Array<{ type: string; text?: string }>): string => {
    return content
        .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
};

export default function testCallModel(pi: ExtensionAPI) {
    pi.registerCommand("test-callmodel", {
        description: "Test callModel API",
        handler: async (_args, ctx) => {
            if (!ctx.model) {
                console.log("ERROR: No model configured");
                return;
            }

            console.log("Testing callModel with model:", ctx.model.name);

            try {
                // Test 1: speed off
                console.log("Test 1: speed=off...");
                const result1 = await ctx.callModel({
                    messages: [{ role: "user", content: "Reply with just the word 'hello'" }],
                    speed: "off",
                });
                const text1 = extractText(result1.content);
                console.log("Result:", text1);

                // Test 2: speed low
                console.log("Test 2: speed=low...");
                const result2 = await ctx.callModel({
                    messages: [{ role: "user", content: "What is 2+2? Answer with just the number." }],
                    speed: "low",
                });
                const text2 = extractText(result2.content);
                console.log("Result:", text2);

                console.log("All tests passed!");
            } catch (error) {
                console.log("Error:", error instanceof Error ? error.message : String(error));
            }
        }
    });
}
`;

console.log("Test script generated:");
console.log("========================");
console.log("To test callModel:");
console.log("1. Copy this extension to .pi/extensions/");
console.log("2. Run: ./pi-test.sh");
console.log("3. In pi, run: /test-callmodel");
console.log("========================");
