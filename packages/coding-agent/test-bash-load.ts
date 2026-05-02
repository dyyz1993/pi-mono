import bashExt from "./extensions/bash-ext/index.ts";

console.log("Extension loaded OK, type:", typeof bashExt);

const mockPi = {
  on: (_ev: string, _fn: any) => {},
  registerChannel: (name: string) => {
    console.log("Channel registered:", name);
    return { 
      send: (d: unknown) => console.log("CHANNEL SEND:", JSON.stringify(d).slice(0,300)), 
      onReceive: () => () => {}, 
      invoke: async () => {} 
    };
  },
  registerTool: (tool: any) => {
    console.log("Tool registered:", tool.name, "execute type:", typeof tool.execute);
  },
  appendEntry: (type: string, _data?: unknown) => console.log("APPEND ENTRY:", type),
};
bashExt(mockPi as any);
console.log("Extension init completed successfully");
