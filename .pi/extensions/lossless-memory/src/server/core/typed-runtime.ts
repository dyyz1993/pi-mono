/**
 * @framework-baseline 967517f35a849acf
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

import { runtime, type RuntimeAdapter } from './runtime'
import type {
  RpcMethod,
  EventName,
  RpcInput,
  RpcOutput,
  EventPayload,
} from '@shared/core/protocol-types'

export interface TypedRuntime<T extends { rpc: unknown; events: unknown }> {
  path: string
  get adapter(): RuntimeAdapter

  registerRPC<M extends RpcMethod<T>>(
    method: M,
    handler: (
      params: RpcInput<T, M>,
      clientId: string
    ) => RpcOutput<T, M> | Promise<RpcOutput<T, M>>
  ): void

  registerEvent<E extends EventName<T>>(
    type: E,
    handler: (payload: EventPayload<T, E>, clientId: string) => void
  ): void

  broadcast<E extends EventName<T>>(event: E, data: EventPayload<T, E>, exclude?: string[]): void
}

export function createTypedRuntime<T extends { rpc: unknown; events: unknown }>(
  path: string
): TypedRuntime<T> {
  return {
    path,
    get adapter(): RuntimeAdapter {
      return runtime.adapter
    },

    registerRPC<M extends RpcMethod<T>>(
      method: M,
      handler: (
        params: RpcInput<T, M>,
        clientId: string
      ) => RpcOutput<T, M> | Promise<RpcOutput<T, M>>
    ): void {
      const wrappedHandler = (params: unknown, clientId: string): unknown => {
        return handler(params as RpcInput<T, M>, clientId)
      }
      runtime.registerRPC(method as string, wrappedHandler)
    },

    registerEvent<E extends EventName<T>>(
      type: E,
      handler: (payload: EventPayload<T, E>, clientId: string) => void
    ): void {
      const wrappedHandler = (payload: unknown, clientId: string): void => {
        handler(payload as EventPayload<T, E>, clientId)
      }
      runtime.registerEvent(type as string, wrappedHandler)
    },

    broadcast<E extends EventName<T>>(
      event: E,
      data: EventPayload<T, E>,
      exclude?: string[]
    ): void {
      runtime.broadcast(event as string, data, exclude)
    },
  }
}
