import path from 'path';
import os from 'os';

function getAgentDir() {
  return path.join(os.homedir(), ".pi", "agent");
}

const agentDir = getAgentDir();
const globalExtDir = path.join(agentDir, "extensions");
console.log("agentDir:", agentDir);
console.log("globalExtDir:", globalExtDir);

import fs from 'fs';
if (fs.existsSync(globalExtDir)) {
  const entries = fs.readdirSync(globalExtDir, { withFileTypes: true });
  console.log("\nExtensions found:");
  for (const e of entries) {
    console.log(`  ${e.name} (file: ${e.isFile()}, dir: ${e.isDirectory()})`);
  }
  
  // Check specifically for glm-provider
  const glmPath = path.join(globalExtDir, "glm-provider.ts");
  console.log("\nglm-provider.ts exists:", fs.existsSync(glmPath));
} else {
  console.log("globalExtDir does not exist!");
}
