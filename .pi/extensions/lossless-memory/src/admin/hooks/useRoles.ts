import { create } from 'zustand'
import { apiClient } from '../services/apiClient'
import type { RoleType, CreateRoleType, UpdateRoleType } from '@shared/modules/role/schemas'

interface RoleState {
  roles: RoleType[]
  loading: boolean
  error: string | null
  fetchRoles: () => Promise<void>
  createRole: (data: CreateRoleType) => Promise<boolean>
  updateRole: (id: string, data: UpdateRoleType) => Promise<boolean>
  deleteRole: (id: string) => Promise<boolean>
  updateRolePermissions: (id: string, permissionIds: string[]) => Promise<boolean>
}

export const useRoleStore = create<RoleState>((set, get) => ({
  roles: [],
  loading: false,
  error: null,

  fetchRoles: async () => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.roles.$get()
      const data = await response.json()

      if (data.success) {
        set({ roles: data.data, loading: false })
      } else {
        set({ error: 'Failed to fetch roles', loading: false })
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  createRole: async (data: CreateRoleType) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.roles.$post({ json: data })
      const result = await response.json()

      if (result.success) {
        await get().fetchRoles()
        return true
      } else {
        set({ error: result.error || 'Failed to create role', loading: false })
        return false
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
      return false
    }
  },

  updateRole: async (id: string, data: UpdateRoleType) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.roles[':id'].$put({
        param: { id },
        json: data,
      })
      const result = await response.json()

      if (result.success) {
        await get().fetchRoles()
        return true
      } else {
        set({ error: result.error || 'Failed to update role', loading: false })
        return false
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
      return false
    }
  },

  deleteRole: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.roles[':id'].$delete({
        param: { id },
      })
      const result = await response.json()

      if (result.success) {
        await get().fetchRoles()
        return true
      } else {
        set({ error: result.error || 'Failed to delete role', loading: false })
        return false
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
      return false
    }
  },

  updateRolePermissions: async (id: string, permissionIds: string[]) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.roles[':id'].permissions.$put({
        param: { id },
        json: { permissionIds },
      })
      const result = await response.json()

      if (result.success) {
        set({ loading: false })
        return true
      } else {
        set({ error: result.error || 'Failed to update role permissions', loading: false })
        return false
      }
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
      return false
    }
  },
}))
