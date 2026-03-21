import { spawn } from 'child_process'

declare global {
  var __DEV_SERVER__: ReturnType<typeof spawn> | undefined
}

export default async function globalTeardown() {
  if (globalThis.__DEV_SERVER__) {
    process.stdout.write('\n🛑 Stopping dev server...\n')
    globalThis.__DEV_SERVER__.kill()
    process.stdout.write('✅ Dev server stopped\n')
  }
}
