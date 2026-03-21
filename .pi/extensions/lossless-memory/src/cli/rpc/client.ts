import { hc } from 'hono/client'
import type { ClientApiType, AppType } from '@server/index'
import { WSClientImpl } from '@shared/core/ws-client'
import { SSEClientImpl } from '@shared/core/sse-client'

export type { AppType }

/**
 * CLI RPC 请求扩展参数
 */
export interface CliFetchExtendOptions {
  /** 是否显示详细日志 */
  verbose?: boolean
  /** 超时时间 */
  timeout?: number
}

export function createRPCClient(baseUrl: string) {
  return hc<ClientApiType>(baseUrl, {
    webSocket: url => new WSClientImpl(url),
    sse: url => new SSEClientImpl(url),
  })
}
