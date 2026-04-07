import { createJiti } from '@mariozechner/jiti';
import path from 'path';
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

const extPath = './.pi/extensions/diff.ts';
try {
  const m = await jiti.import(extPath, { default: true });
  console.log('diff.ts LOADED OK, type:', typeof m);
} catch(e) {
  console.error('diff.ts ERROR:', e.message);
}

const extPath2 = './packages/coding-agent/examples/extensions/openviking-memory/src/index.ts';
try {
  const m2 = await jiti.import(extPath2, { default: true });
  console.log('openviking LOADED OK, type:', typeof m2);
} catch(e) {
  console.error('openviking ERROR:', e.message);
}
