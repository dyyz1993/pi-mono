/**
 * @framework-baseline 82eff0212fda8f63
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

import { isCloudflare } from '../utils/env'

export interface BroadcastMessage {
  event: string
  data: unknown
}

export interface RealtimeService {
  broadcast(event: string, data: unknown): Promise<void>
}

let _env: { REALTIME_DO?: DurableObjectNamespace } | null = null
let _realtimeService: RealtimeService | null = null

export function setRealtimeEnv(env: { REALTIME_DO?: DurableObjectNamespace }): void {
  _env = env
  _realtimeService = null
}

function createRealtimeService(): RealtimeService {
  if (isCloudflare && _env?.REALTIME_DO) {
    return {
      async broadcast(event: string, data: unknown): Promise<void> {
        const id = _env!.REALTIME_DO!.idFromName('global')
        const stub = _env!.REALTIME_DO!.get(id)
        await stub.fetch(
          new Request('https://internal/broadcast', {
            method: 'POST',
            body: JSON.stringify({ event, data }),
          })
        )
      },
    }
  }

  return {
    async broadcast(event: string, data: unknown): Promise<void> {
      const { getRuntimeAdapter } = await import('./runtime')
      getRuntimeAdapter().broadcast(event, data)
    },
  }
}

export function getRealtimeService(): RealtimeService {
  if (!_realtimeService) {
    _realtimeService = createRealtimeService()
  }
  return _realtimeService
}

export const realtime: RealtimeService = new Proxy({} as RealtimeService, {
  get(_target, prop) {
    const service = getRealtimeService()
    return Reflect.get(service, prop, service)
  },
})

export { RealtimeDurableObject } from './durable-objects/RealtimeDO'
export type { RealtimeCore, RPCHandler, EventHandler } from './realtime-core'
export { createRealtimeCore, createWSMessageHandler } from './realtime-core'

export {
  runtime,
  setRuntimeAdapter,
  getRuntimeAdapter,
  type RuntimeAdapter,
  type RuntimePlatform,
  type WSConnection,
  type SSEConnection,
} from './runtime'
export { createTypedRuntime, type TypedRuntime } from './typed-runtime'
export { NodeRuntimeAdapter, getNodeRuntimeAdapter } from './runtime-node'
export { CloudflareRuntimeAdapter, getCloudflareRuntimeAdapter } from './runtime-cloudflare'
