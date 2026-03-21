import { create } from 'zustand'
import { apiClient } from '@client/services/apiClient'
import type { Todo, CreateTodoInput, UpdateTodoInput, TodoAttachment } from '@shared/schemas'

interface TodoState {
  todos: Todo[]
  loading: boolean
  error: string | null
  attachments: Map<number, TodoAttachment[]>

  fetchTodos: () => Promise<void>
  createTodo: (input: CreateTodoInput) => Promise<void>
  updateTodo: (id: number, input: UpdateTodoInput) => Promise<void>
  deleteTodo: (id: number) => Promise<void>
  uploadAttachment: (todoId: number, file: File) => Promise<TodoAttachment | null>
  fetchAttachments: (todoId: number) => Promise<void>
  deleteAttachment: (todoId: number, attachmentId: number) => Promise<void>
  setError: (error: string | null) => void
}

export const useTodoStore = create<TodoState>(set => ({
  todos: [],
  loading: false,
  error: null,
  attachments: new Map(),

  fetchTodos: async () => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.todos.$get()
      const result = await response.json()
      if (result.success) {
        const data = result.data as Todo[] | { items: Todo[] }
        const items = Array.isArray(data) ? data : data.items || []
        set({ todos: items, loading: false })
      } else {
        set({ error: result.error, loading: false })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
    }
  },

  createTodo: async (input: CreateTodoInput) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.todos.$post({
        json: input,
      })
      const result = await response.json()
      if (result.success) {
        set(state => ({
          todos: [result.data, ...state.todos],
          loading: false,
        }))
      } else {
        set({ error: result.error, loading: false })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
    }
  },

  updateTodo: async (id: number, input: UpdateTodoInput) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.todos[':id'].$put({
        param: { id: id.toString() },
        json: input,
      })
      const result = await response.json()
      if (result.success) {
        set(state => ({
          todos: state.todos.map(todo => (todo.id === id ? result.data : todo)),
          loading: false,
        }))
      } else {
        set({ error: result.error, loading: false })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
    }
  },

  deleteTodo: async (id: number) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.todos[':id'].$delete({
        param: { id: id.toString() },
      })
      const result = await response.json()
      if (result.success) {
        set(state => {
          const newAttachments = new Map(state.attachments)
          newAttachments.delete(id)
          return {
            todos: state.todos.filter(todo => todo.id !== id),
            attachments: newAttachments,
            loading: false,
          }
        })
      } else {
        set({ error: result.error, loading: false })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
    }
  },

  uploadAttachment: async (todoId: number, file: File): Promise<TodoAttachment | null> => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.todos[':id'].attachments.$post({
        param: { id: todoId.toString() },
        form: { file },
      })

      const result = (await response.json()) as {
        success: boolean
        data?: TodoAttachment
        error?: string
      }
      if (result.success && result.data) {
        set(state => {
          const newAttachments = new Map(state.attachments)
          const existing = newAttachments.get(todoId) || []
          newAttachments.set(todoId, [...existing, result.data!])
          return { attachments: newAttachments, loading: false }
        })
        return result.data
      } else {
        set({ error: result.error || 'Upload failed', loading: false })
        return null
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
      return null
    }
  },

  fetchAttachments: async (todoId: number) => {
    try {
      const response = await apiClient.api.todos[':id'].attachments.$get({
        param: { id: todoId.toString() },
      })
      const result = await response.json()
      if (result.success) {
        set(state => {
          const newAttachments = new Map(state.attachments)
          const data = result.data as TodoAttachment[] | { items: TodoAttachment[] }
          const items = Array.isArray(data) ? data : data.items || []
          newAttachments.set(todoId, items)
          return { attachments: newAttachments }
        })
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error)
    }
  },

  deleteAttachment: async (todoId: number, attachmentId: number) => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.todos[':todoId'].attachments[':attachmentId'].$delete({
        param: { todoId: todoId.toString(), attachmentId: attachmentId.toString() },
      })
      const result = await response.json()
      if (result.success) {
        set(state => {
          const newAttachments = new Map(state.attachments)
          const existing = newAttachments.get(todoId) || []
          newAttachments.set(
            todoId,
            existing.filter(a => a.id !== attachmentId)
          )
          return { attachments: newAttachments, loading: false }
        })
      } else {
        set({ error: result.error, loading: false })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
    }
  },

  setError: (error: string | null) => {
    set({ error })
  },
}))
