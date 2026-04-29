import bashExt from "./test/auto-memory/bash.ts";

const events: string[] = [];
const mockPi = {
  on: (ev: string, fn: any) => {
    if (ev === "session_start") fn({}, {} as any);
  },
  registerChannel: (name: string) => {
    console.log("Channel registered:", name);
    return { 
      send: (d: unknown) => { 
        const msg = d as any;
        events.push(msg.type);
        console.log(`[${msg.type}]`, JSON.stringify(d).slice(0,200)); 
      }, 
      onReceive: (h: any) => {}, 
      invoke: async () => {} 
    };
  },
  registerTool: (tool: any) => {
    console.log("Tool registered:", tool.name);
    
    // Simulate executing the bash tool
    (async () => {
      try {
        console.log("\n--- Executing: echo hello ---");
        const result = await tool.execute(
          "tc_1",
          { command: "echo hello" },
          undefined,
          undefined,
          { cwd: "/tmp" } as any,
        );
        console.log("Result:", result?.content?.[0]?.text?.slice(0,100));
      } catch(e) {
        console.error("Error:", e.message);
      }
      console.log("\nAll channel events:", events);
    })();
  },
  appendEntry: (type: string, _data?: unknown) => console.log("APPEND ENTRY:", type),
};
bashExt(mockPi as any);

// Wait for async execution
setTimeout(() => {}, 3000);
