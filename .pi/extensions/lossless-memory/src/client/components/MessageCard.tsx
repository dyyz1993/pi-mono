import type { ColorScheme } from './StatusBadge'

interface MessageCardProps {
  type: string
  payload: unknown
  timestamp?: number
  icon?: React.ComponentType<{ className?: string }>
  colorScheme?: ColorScheme
  borderColor?: string
  className?: string
}

const colorMap: Record<ColorScheme, { bg: string }> = {
  gray: { bg: 'bg-gray-500' },
  blue: { bg: 'bg-blue-500' },
  green: { bg: 'bg-green-500' },
  red: { bg: 'bg-red-500' },
  yellow: { bg: 'bg-yellow-500' },
  purple: { bg: 'bg-purple-500' },
  orange: { bg: 'bg-orange-500' },
  cyan: { bg: 'bg-cyan-500' },
  indigo: { bg: 'bg-indigo-500' },
}

export const MessageCard: React.FC<MessageCardProps> = ({
  type,
  payload,
  timestamp,
  icon: Icon,
  colorScheme = 'gray',
  borderColor,
  className = '',
}) => {
  const colors = colorMap[colorScheme]
  const displayType = type.includes('_') ? type.toUpperCase().replace('_', ' ') : type.toUpperCase()

  return (
    <div
      className={`p-4 bg-white rounded-lg border-l-4 shadow-sm ${className}`}
      style={{ borderLeftColor: borderColor || undefined }}
      data-testid="message-card"
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${colors.bg}`}
        >
          {Icon && <Icon className="w-3 h-3" />}
          {displayType}
        </span>
        {timestamp && (
          <span className="text-xs text-gray-400">{new Date(timestamp).toLocaleTimeString()}</span>
        )}
      </div>
      <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-mono">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  )
}
