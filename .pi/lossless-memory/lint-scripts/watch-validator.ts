#!/usr/bin/env tsx
/**
 * 文件监听验证器
 *
 * 监听文件变化，立即触发验证
 * 适用于 AI 编码场景：创建/修改文件时即时反馈
 */

import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { cwd } from 'node:process';
import { join, extname, relative } from 'node:path';
import { spawn } from 'node:child_process';

const rootPath = cwd();
const WATCH_DIRS = ['src', 'lint-scripts'];
const WATCH_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const DEBOUNCE_MS = 300;

const pendingValidations = new Map<string, NodeJS.Timeout>();
let isRunning = false;

function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    info: '🔍',
    error: '❌',
    success: '✅',
  }[type];
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function getAllDirs(dir: string): Promise<string[]> {
  const dirs: string[] = [dir];
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const subDir = join(dir, entry.name);
      dirs.push(...await getAllDirs(subDir));
    }
  }
  return dirs;
}

function runValidation(filePath: string) {
  if (isRunning) {
    log('Validation already running, skipping...', 'info');
    return;
  }

  isRunning = true;
  const relPath = relative(rootPath, filePath);
  log(`File changed: ${relPath}`, 'info');

  const child = spawn('node', ['--import', 'tsx/esm', 'lint-scripts/validate-all.ts'], {
    cwd: rootPath,
    stdio: 'inherit',
    shell: true,
  });

  child.on('close', (code) => {
    isRunning = false;
    if (code === 0) {
      log('Validation passed', 'success');
    } else {
      log('Validation failed', 'error');
    }
  });

  child.on('error', (err) => {
    isRunning = false;
    log(`Validation error: ${err.message}`, 'error');
  });
}

function debounceValidation(filePath: string) {
  if (pendingValidations.has(filePath)) {
    clearTimeout(pendingValidations.get(filePath)!);
  }
  
  const timeout = setTimeout(() => {
    pendingValidations.delete(filePath);
    runValidation(filePath);
  }, DEBOUNCE_MS);
  
  pendingValidations.set(filePath, timeout);
}

async function watchDir(dir: string) {
  const absDir = join(rootPath, dir);
  
  try {
    await stat(absDir);
  } catch {
    log(`Directory not found: ${dir}`, 'error');
    return;
  }

  const allDirs = await getAllDirs(absDir);
  
  for (const d of allDirs) {
    watch(d, (eventType, filename) => {
      if (!filename) return;
      
      const ext = extname(filename);
      if (!WATCH_EXTENSIONS.includes(ext)) return;
      
      const filePath = join(d, filename);
      debounceValidation(filePath);
    });
  }
  
  log(`Watching: ${dir} (${allDirs.length} directories)`, 'info');
}

async function main() {
  console.log('\n🚀 File Watch Validator Started');
  console.log('='.repeat(50));
  console.log(`📁 Watching directories: ${WATCH_DIRS.join(', ')}`);
  console.log(`📄 File extensions: ${WATCH_EXTENSIONS.join(', ')}`);
  console.log(`⏱️  Debounce: ${DEBOUNCE_MS}ms`);
  console.log('='.repeat(50));
  console.log('\nPress Ctrl+C to stop\n');

  for (const dir of WATCH_DIRS) {
    await watchDir(dir);
  }
}

main().catch(console.error);
