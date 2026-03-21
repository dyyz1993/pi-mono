/**
 * @framework-baseline ab15d84c70311810
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

export type RpcMethod<T extends { rpc: unknown }> = keyof T['rpc']
export type EventName<T extends { events: unknown }> = keyof T['events']

export type RpcInput<T extends { rpc: unknown }, M extends RpcMethod<T>> = T['rpc'][M] extends {
  in: infer I
}
  ? I
  : never

export type RpcOutput<T extends { rpc: unknown }, M extends RpcMethod<T>> = T['rpc'][M] extends {
  out: infer O
}
  ? O
  : never

export type EventPayload<T extends { events: unknown }, E extends EventName<T>> = T['events'][E]
