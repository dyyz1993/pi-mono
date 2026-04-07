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

try {
  const m = await jiti.import('/Users/xuyingzhou/.pi/agent/extensions/glm-provider.ts', { default: true });
  console.log('GLM provider LOADED OK, type:', typeof m);
} catch(e) {
  console.error('GLM provider ERROR:', e.message);
  console.error('STACK:', e.stack?.split('\n').slice(0,8).join('\n'));
}
