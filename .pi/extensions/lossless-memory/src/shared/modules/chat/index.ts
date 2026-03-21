import { z } from '@hono/zod-openapi'

export const ChatProtocolSchema = z.object({
  rpc: z.object({
    echo: z.object({
      in: z.object({ message: z.string() }),
      out: z.object({ message: z.string(), timestamp: z.number() }),
    }),
    ping: z.object({
      in: z.object({}),
      out: z.object({ pong: z.boolean(), timestamp: z.number() }),
    }),
  }),
  events: z.object({
    notification: z.object({
      title: z.string(),
      body: z.string(),
      timestamp: z.number(),
    }),
    broadcast: z.object({
      message: z.string(),
      timestamp: z.number(),
    }),
    connected: z.object({
      timestamp: z.number(),
    }),
    disconnected: z.object({
      timestamp: z.number(),
    }),
  }),
})

export const WebSocketStatusSchema = z.object({
  connectedClients: z.number(),
})

export type ChatProtocol = z.infer<typeof ChatProtocolSchema>
export type WebSocketStatus = z.infer<typeof WebSocketStatusSchema>
