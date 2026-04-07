import path from 'path';
import fs from 'fs';
import { createJiti } from '@mariozechner/jiti';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const packagesRoot = path.resolve(__dirname);

const typeboxEntry = req.resolve("@sinclair/typebox");
const typeboxRoot = typeboxEntry.replace(/[\\/]build[\\/]cjs[\\/]index\.js$/, "");

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: {
    '@mariozechner/pi-coding-agent': path.resolve(__dirname, 'packages/coding-agent/dist/index.js'),
    '@mariozechner/pi-ai': path.resolve(packagesRoot, 'packages/ai/dist/index.js'),
    '@sinclair/typebox': typeboxRoot,
  }
});

// Simulate resolveExtensionEntries
function resolveExtensionEntries(dir) {
  const packageJsonPath = path.join(dir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.pi && typeof pkg.pi === 'object') {
      if (pkg.pi.extensions?.length) {
        const entries = [];
        for (const extPath of pkg.pi.extensions) {
          const resolvedExtPath = path.resolve(dir, extPath);
          if (fs.existsSync(resolvedExtPath)) entries.push(resolvedExtPath);
        }
        if (entries.length > 0) return entries;
      }
    }
  }
  return null;
}

const extDir = './packages/coding-agent/examples/extensions/openviking-memory';
const resolvedDir = path.resolve(extDir);
console.log('Dir exists:', fs.existsSync(resolvedDir));
console.log('Entries:', resolveExtensionEntries(resolvedDir));

if (resolveExtensionEntries(resolvedDir)) {
  for (const entryPath of resolveExtensionEntries(resolvedDir)) {
    console.log('Loading:', entryPath);
    try {
      const m = await jiti.import(entryPath, { default: true });
      console.log('LOADED OK, type:', typeof m);
    } catch(e) {
      console.error('LOAD ERROR:', e.message);
      console.error('STACK:', e.stack?.split('\n').slice(0,5).join('\n'));
    }
  }
}
