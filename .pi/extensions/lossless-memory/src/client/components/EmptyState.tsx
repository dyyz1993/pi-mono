import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  className?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center h-full text-gray-500 ${className}`}
      data-testid="empty-state"
    >
      <Icon className="w-16 h-16 mb-4 text-gray-300" />
      <p className="text-center">{title}</p>
      {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
    </div>
  )
}
