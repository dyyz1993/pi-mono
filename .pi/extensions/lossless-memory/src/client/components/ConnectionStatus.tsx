import { Wifi, WifiOff, Loader2 } from 'lucide-react'

interface ConnectionStatusProps {
  connected: boolean
  status?: string
  loading?: boolean
  onConnect: () => void
  onDisconnect: () => void
  connectDisabled?: boolean
  disconnectDisabled?: boolean
  className?: string
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  connected,
  status,
  loading = false,
  onConnect,
  onDisconnect,
  connectDisabled = false,
  disconnectDisabled = false,
  className = '',
}) => {
  const statusText = status || (connected ? 'Connected' : 'Disconnected')
  const statusColor = connected ? 'text-green-600' : 'text-red-500'

  return (
    <div
      className={`p-4 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4 ${className}`}
      data-testid="connection-status"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700">Status:</span>
        <span className={`flex items-center gap-1 ${statusColor}`}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : connected ? (
            <Wifi className="w-4 h-4" />
          ) : (
            <WifiOff className="w-4 h-4" />
          )}
          {statusText}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onConnect}
          disabled={connected || loading || connectDisabled}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            connected || loading || connectDisabled
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
          data-testid="connect-button"
        >
          <Wifi className="w-4 h-4" />
          Connect
        </button>
        <button
          onClick={onDisconnect}
          disabled={!connected || disconnectDisabled}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !connected || disconnectDisabled
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-red-500 text-white hover:bg-red-600'
          }`}
          data-testid="disconnect-button"
        >
          <WifiOff className="w-4 h-4" />
          Disconnect
        </button>
      </div>
    </div>
  )
}
