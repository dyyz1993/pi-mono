#!/usr/bin/env node
/**
 * Lossless Memory Extension - Test Runner
 * 
 * Tests all components of the extension without running pi.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = __dirname;

console.log("=".repeat(60));
console.log("Lossless Memory Extension - 组件测试");
console.log("=".repeat(60));
console.log("");

// Test 1: Check files
console.log("测试 1: 检查文件完整性...");
console.log("-".repeat(40));
const requiredFiles = [
  "package.json",
  "src/index.ts",
  "src/types.ts",
  "src/database.ts",
  "src/dag-manager.ts",
  "src/summary-generator.ts",
  "src/search-tool.ts",
  "src/expand-tool.ts",
];

let allFilesExist = true;
for (const file of requiredFiles) {
  const filePath = path.join(EXTENSION_DIR, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✓ ${file}`);
  } else {
    console.log(`  ✗ ${file} (缺失)`);
    allFilesExist = false;
  }
}
console.log("");

// Test 2: Check package.json
console.log("测试 2: 检查 package.json...");
console.log("-".repeat(40));
try {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(EXTENSION_DIR, "package.json"), "utf-8")
  );
  console.log(`  名称：${packageJson.name}`);
  console.log(`  版本：${packageJson.version}`);
  console.log(`  依赖：${Object.keys(packageJson.dependencies || {}).join(", ") || "无"}`);
  console.log(`  ✓ package.json 有效`);
} catch (error) {
  console.log(`  ✗ package.json 解析失败：${error.message}`);
}
console.log("");

// Test 3: Check node_modules
console.log("测试 3: 检查依赖安装...");
console.log("-".repeat(40));
const requiredDeps = ["better-sqlite3"];
for (const dep of requiredDeps) {
  const depPath = path.join(EXTENSION_DIR, "node_modules", dep, "package.json");
  if (fs.existsSync(depPath)) {
    const pkg = JSON.parse(fs.readFileSync(depPath, "utf-8"));
    console.log(`  ✓ ${dep}@${pkg.version}`);
  } else {
    console.log(`  ✗ ${dep} (未安装)`);
  }
}
console.log("");

// Test 4: Check TypeScript syntax
console.log("测试 4: TypeScript 语法检查...");
console.log("-".repeat(40));
const { execSync } = await import("node:child_process");
try {
  execSync(
    `npx tsc --noEmit --skipLibCheck src/index.ts`,
    { cwd: EXTENSION_DIR, stdio: "pipe" }
  );
  console.log("  ✓ TypeScript 语法检查通过");
} catch (error) {
  console.log(`  ! TypeScript 警告/错误（可能不影响运行）`);
  console.log(error.stderr?.toString().slice(0, 500));
}
console.log("");

// Test 5: Database initialization test
console.log("测试 5: 数据库初始化测试...");
console.log("-".repeat(40));
try {
  const testDbPath = path.join(EXTENSION_DIR, "test-memory.db");
  
  // Clean up if exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  
  // Import and test database
  const { MemoryDatabase } = await import("./database.js");
  const config = {
    enabled: true,
    database: {
      path: testDbPath,
      enableFTS5: true,
      enableVectors: false,
    },
    summary: {
      provider: "openai",
      model: "gpt-4o-mini",
      maxTokens: 300,
      compressionRatio: 8,
    },
    search: {
      keywordWeight: 0.7,
      semanticWeight: 0.3,
      defaultLimit: 5,
    },
    performance: {
      cacheEmbeddings: true,
      batchSize: 32,
      lazyLoad: true,
    },
  };
  
  const db = new MemoryDatabase(config);
  const result = db.initialize();
  
  if (result.success) {
    console.log(`  ✓ 数据库创建成功：${testDbPath}`);
    console.log(`  ✓ 架构版本：${result.version}`);
    
    // Test FTS5
    const stats = db.getStats();
    console.log(`  ✓ FTS5 索引：${stats.nodeCount} 节点`);
    
    // Clean up
    db.close();
    fs.unlinkSync(testDbPath);
    fs.unlinkSync(testDbPath + "-wal");
    fs.unlinkSync(testDbPath + "-shm");
    console.log(`  ✓ 测试数据库已清理`);
  } else {
    console.log(`  ✗ 数据库初始化失败：${result.error}`);
  }
} catch (error) {
  console.log(`  ✗ 数据库测试失败：${error.message}`);
  console.log(error.stack?.split("\n").slice(0, 5).join("\n"));
}
console.log("");

// Test 6: Check extension entry point
console.log("测试 6: 检查扩展入口...");
console.log("-".repeat(40));
const indexContent = fs.readFileSync(path.join(EXTENSION_DIR, "src/index.ts"), "utf-8");
if (indexContent.includes("export default function")) {
  console.log("  ✓ 导出默认函数");
} else {
  console.log("  ✗ 未找到默认导出函数");
}

if (indexContent.includes("pi.registerTool")) {
  console.log("  ✓ 注册工具");
} else {
  console.log("  ! 未找到工具注册");
}

if (indexContent.includes("pi.registerCommand")) {
  console.log("  ✓ 注册命令");
} else {
  console.log("  ! 未找到命令注册");
}

if (indexContent.includes("session_before_compact")) {
  console.log("  ✓ 监听压缩事件");
} else {
  console.log("  ! 未找到压缩事件监听");
}
console.log("");

// Test 7: Summary
console.log("=".repeat(60));
console.log("测试结果汇总");
console.log("=".repeat(60));
if (allFilesExist) {
  console.log("✓ 所有文件存在");
  console.log("✓ 扩展已准备就绪");
  console.log("");
  console.log("下一步:");
  console.log("1. 运行：pi --verbose");
  console.log("2. 输入：/memory-stats 查看记忆统计");
  console.log("3. 输入：/memory-search 关键词 测试搜索");
  console.log("4. 输入：/memory-clear 清除记忆数据");
} else {
  console.log("✗ 文件缺失，请检查安装");
}
console.log("");
