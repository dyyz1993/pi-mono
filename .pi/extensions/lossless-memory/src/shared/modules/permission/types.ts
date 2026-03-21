import { Permission } from './permissions'

export interface MenuItem {
  path: string
  label: string
  icon: string
  permissions: Permission[]
  children?: MenuItem[]
}

export interface PageAction {
  key: string
  label: string
  permissions: Permission[]
  mode: 'any' | 'all'
}

export interface PagePermissionConfig {
  path: string
  label: string
  requiredPermissions: Permission[]
  actions: PageAction[]
}
