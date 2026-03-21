import { useState, useEffect } from 'react'
import { apiClient } from '../services/apiClient'
import type {
  MenuItem,
  PagePermissionConfig,
  PermissionCategory,
  Role,
  Permission,
  PermissionInfo,
} from '@shared/modules/permission'

export function useMenuConfig() {
  const [menuConfig, setMenuConfig] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMenuConfig = async () => {
      try {
        setLoading(true)
        const response = await apiClient.api.permissions['menu-config'].$get()
        const data = await response.json()
        if (data.success) {
          setMenuConfig(data.data)
        }
      } catch (error) {
        console.error('Failed to fetch menu config:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchMenuConfig()
  }, [])

  return { menuConfig, loading }
}

export function usePagePermissions() {
  const [pagePermissions, setPagePermissions] = useState<PagePermissionConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPagePermissions = async () => {
      try {
        setLoading(true)
        const response = await apiClient.api.permissions['page-permissions'].$get()
        const data = await response.json()
        if (data.success) {
          setPagePermissions(data.data)
        }
      } catch (error) {
        console.error('Failed to fetch page permissions:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPagePermissions()
  }, [])

  return { pagePermissions, loading }
}

export function usePermissionCategories() {
  const [categories, setCategories] = useState<Record<string, PermissionCategory>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true)
        const response = await apiClient.api.permissions.categories.$get()
        const data = await response.json()
        if (data.success) {
          setCategories(data.data as Record<string, PermissionCategory>)
        }
      } catch (error) {
        console.error('Failed to fetch permission categories:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchCategories()
  }, [])

  return { categories, loading }
}

export function useRoleLabels() {
  const [roleLabels, setRoleLabels] = useState<Record<Role, string>>({} as Record<Role, string>)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchRoleLabels = async () => {
      try {
        setLoading(true)
        const response = await apiClient.api.permissions['role-labels'].$get()
        const data = await response.json()
        if (data.success) {
          setRoleLabels(data.data as Record<Role, string>)
        }
      } catch (error) {
        console.error('Failed to fetch role labels:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchRoleLabels()
  }, [])

  return { roleLabels, loading }
}

export function usePermissionLabels() {
  const [permissionLabels, setPermissionLabels] = useState<Record<Permission, string>>(
    {} as Record<Permission, string>
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPermissionLabels = async () => {
      try {
        setLoading(true)
        const response = await apiClient.api.permissions['permission-labels'].$get()
        const data = await response.json()
        if (data.success) {
          setPermissionLabels(data.data as Record<Permission, string>)
        }
      } catch (error) {
        console.error('Failed to fetch permission labels:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPermissionLabels()
  }, [])

  return { permissionLabels, loading }
}

export function useConfig() {
  const [permissions, setPermissions] = useState<PermissionInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        setLoading(true)
        const response = await apiClient.api.permissions.$get()
        const data = await response.json()
        if (data.success) {
          setPermissions(data.data)
        }
      } catch (error) {
        console.error('Failed to fetch permissions:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPermissions()
  }, [])

  return { permissions, loading }
}
