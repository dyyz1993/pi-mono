import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  Headphones,
  FileText,
  AlertTriangle,
  Settings,
  Shield,
  UserCog,
  Activity,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { usePermissions } from '../hooks/usePermissions'
import { useMenuConfig } from '../hooks/useConfig'
import type { MenuItem } from '@shared/modules/permission'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  ShoppingCart,
  Headphones,
  FileText,
  AlertTriangle,
  Settings,
  Shield,
  UserCog,
  Activity,
}

interface SidebarProps {
  isOpen: boolean
}

interface MenuItemComponentProps {
  item: MenuItem
  level?: number
}

const MenuItemComponent: React.FC<MenuItemComponentProps> = ({ item, level = 0 }) => {
  const [expanded, setExpanded] = useState(false)
  const { hasAnyPermission } = usePermissions()
  const Icon = ICON_MAP[item.icon] || LayoutDashboard
  const hasChildren = item.children && item.children.length > 0

  if (item.permissions && item.permissions.length > 0 && !hasAnyPermission(item.permissions)) {
    return null
  }

  if (hasChildren) {
    const visibleChildren = item.children!.filter(child => {
      if (!child.permissions || child.permissions.length === 0) {
        return true
      }
      return hasAnyPermission(child.permissions)
    })

    if (visibleChildren.length === 0) {
      return null
    }

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors text-gray-300 hover:bg-gray-800 ${
            level > 0 ? 'pl-8' : ''
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="flex-1 text-left">{item.label}</span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {expanded && (
          <div className="ml-4">
            {visibleChildren.map(child => (
              <MenuItemComponent key={child.path} item={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
          isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
        } ${level > 0 ? 'pl-8 text-sm' : ''}`
      }
    >
      <Icon className="w-5 h-5" />
      <span>{item.label}</span>
    </NavLink>
  )
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  const { menuConfig, loading } = useMenuConfig()

  if (loading) {
    return (
      <aside className="bg-gray-900 text-white w-64 overflow-hidden" data-testid="admin-sidebar">
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800">
          <h1 className="text-lg font-bold">Admin Panel</h1>
        </div>
        <nav className="p-4">
          <div className="text-gray-400">加载中...</div>
        </nav>
      </aside>
    )
  }

  return (
    <aside
      className={`bg-gray-900 text-white transition-all duration-300 ${
        isOpen ? 'w-64' : 'w-0'
      } overflow-hidden`}
      data-testid="admin-sidebar"
    >
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800">
        <h1 className="text-lg font-bold">Admin Panel</h1>
      </div>
      <nav className="p-4">
        {menuConfig.map((item: MenuItem) => (
          <MenuItemComponent key={item.path} item={item} />
        ))}
      </nav>
    </aside>
  )
}
