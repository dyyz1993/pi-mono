import { createBashToolDefinition } from "./src/core/tools/index.js";

const builtinDef = createBashToolDefinition({ exec: async () => "" });

console.log("=== BUILTIN ===");
console.log("name:", builtinDef.name);
console.log("params:", JSON.stringify(builtinDef.parameters).slice(0,200));

// Simulate what our extension registers
const customTool = {
  name: "bash",
  label: "bash",
  description: "Custom bash with PID tracking",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command" },
      timeout: { type: "number", description: "Timeout" },
    },
    required: ["command"],
  },
};

console.log("\n=== CUSTOM ===");
console.log("name:", customTool.name);
console.log("params:", JSON.stringify(customTool.parameters).slice(0,200));

// Check if _refreshToolRegistry would accept our tool
const baseTools = new Map([["bash", { definition: builtinDef, sourceInfo: "<builtin>" }]]);
baseTools.set("bash", { definition: customTool as any, sourceInfo: "<ext>" });
const final = baseTools.get("bash")!;
console.log("\n=== AFTER SET ===");
console.log("source:", final.sourceInfo);
console.log("desc:", final.definition.description);
