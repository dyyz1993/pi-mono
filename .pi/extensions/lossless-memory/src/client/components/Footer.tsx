export const Footer: React.FC = () => {
  return (
    <footer
      className="py-8 text-center text-gray-500 text-sm border-t border-gray-200 bg-white"
      data-testid="app-footer"
    >
      <p className="flex items-center justify-center gap-2">
        Built with <span className="font-medium text-gray-700">Hono RPC</span> +{' '}
        <span className="font-medium text-gray-700">React</span> +{' '}
        <span className="font-medium text-gray-700">TypeScript</span>
      </p>
      <p className="mt-2 text-xs text-gray-400">
        Demonstrates: CRUD Operations | SSE (Server-Sent Events) | WebSocket
      </p>
    </footer>
  )
}
