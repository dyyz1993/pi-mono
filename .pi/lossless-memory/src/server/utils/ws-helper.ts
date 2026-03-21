import { upgradeWebSocket } from 'hono/cloudflare-workers';
import { isCloudflare } from './env';

export { isCloudflare };

export function createCloudflareWSHandler(
  onMessage: (data: string, send: (msg: string) => void, close: () => void) => void,
  _onOpen?: () => void,
  onClose?: () => void
) {
  return upgradeWebSocket(() => ({
    onMessage(event: MessageEvent) {
      const ws = event.target as WebSocket;
      onMessage(
        event.data as string,
        (msg) => ws.send(msg),
        () => ws.close()
      );
    },
    onClose() {
      onClose?.();
    },
    onOpen(_event: Event, ws: WebSocket) {
      ws.send(JSON.stringify({
        type: 'connected',
        payload: { timestamp: Date.now() },
      }));
    },
  }));
}
