/**
 * Todo Page
 * Demonstrates CRUD operations with Hono RPC
 */

import { useState, useEffect, useRef } from 'react'
import {
  Plus,
  Trash2,
  CheckCircle,
  Circle,
  Clock,
  Paperclip,
  X,
  Upload,
  Download,
} from 'lucide-react'
import { useTodoStore } from '../stores/todoStore'
import { LoadingSpinner, EmptyState } from '@client/components'
import type { Todo } from '@shared/schemas'

type FilterType = 'all' | 'pending' | 'in_progress' | 'completed'

export const TodoPage: React.FC = () => {
  const todos = useTodoStore(state => state.todos)
  const loading = useTodoStore(state => state.loading)
  const error = useTodoStore(state => state.error)
  const attachments = useTodoStore(state => state.attachments)
  const fetchTodos = useTodoStore(state => state.fetchTodos)
  const createTodo = useTodoStore(state => state.createTodo)
  const updateTodo = useTodoStore(state => state.updateTodo)
  const deleteTodo = useTodoStore(state => state.deleteTodo)
  const uploadAttachment = useTodoStore(state => state.uploadAttachment)
  const fetchAttachments = useTodoStore(state => state.fetchAttachments)
  const deleteAttachment = useTodoStore(state => state.deleteAttachment)

  const [newTodoTitle, setNewTodoTitle] = useState('')
  const [newTodoDescription, setNewTodoDescription] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [expandedTodoId, setExpandedTodoId] = useState<number | null>(null)
  const fileInputRefs = useRef<Map<number, HTMLInputElement>>(new Map())

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTodoTitle.trim()) return

    await createTodo({
      title: newTodoTitle,
      description: newTodoDescription || undefined,
    })

    setNewTodoTitle('')
    setNewTodoDescription('')
  }

  const handleStatusChange = async (todo: Todo, status: Todo['status']) => {
    await updateTodo(todo.id, { status })
  }

  const handleDelete = async (id: number) => {
    await deleteTodo(id)
  }

  const handleToggleExpand = async (todoId: number) => {
    if (expandedTodoId === todoId) {
      setExpandedTodoId(null)
    } else {
      setExpandedTodoId(todoId)
      if (!attachments.has(todoId)) {
        await fetchAttachments(todoId)
      }
    }
  }

  const handleFileUpload = async (todoId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await uploadAttachment(todoId, file)
      e.target.value = ''
    }
  }

  const handleDeleteAttachment = async (todoId: number, attachmentId: number) => {
    await deleteAttachment(todoId, attachmentId)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const filteredTodos = todos.filter(todo => {
    if (filter === 'all') return true
    return todo.status === filter
  })

  const statusConfig = {
    pending: { icon: Circle, color: 'text-gray-400', bg: 'bg-gray-100' },
    in_progress: { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-50' },
    completed: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
  }

  return (
    <div className="max-w-3xl mx-auto p-6" data-testid="todo-page">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-gray-900 flex items-center gap-2"
          data-testid="todo-title"
        >
          <CheckCircle className="w-8 h-8 text-blue-500" />
          Todo List
        </h1>
        <p className="text-gray-500 mt-2">
          Demonstrates CRUD operations with Hono RPC type inference
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="mb-8 p-6 bg-white rounded-xl shadow-sm border border-gray-200"
        data-testid="todo-form"
      >
        <div className="mb-4">
          <input
            type="text"
            value={newTodoTitle}
            onChange={e => setNewTodoTitle(e.target.value)}
            placeholder="Todo title..."
            data-testid="todo-title-input"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
          />
        </div>
        <div className="mb-4">
          <textarea
            value={newTodoDescription}
            onChange={e => setNewTodoDescription(e.target.value)}
            placeholder="Description (optional)..."
            data-testid="todo-description-input"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none min-h-[100px]"
          />
        </div>
        <button
          type="submit"
          disabled={!newTodoTitle.trim() || loading}
          data-testid="add-todo-button"
          className="flex items-center gap-2 px-6 py-3 text-base font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <LoadingSpinner size="sm" color="text-white" /> : <Plus className="w-5 h-5" />}
          Add Todo
        </button>
      </form>

      {error && (
        <div
          className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg"
          data-testid="error-message"
        >
          {error}
        </div>
      )}

      {loading && todos.length === 0 && (
        <div className="flex items-center justify-center py-12" data-testid="loading-indicator">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {todos.length > 0 && (
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2" data-testid="todo-count">
            <span className="text-sm text-gray-500">Total:</span>
            <span className="text-sm font-medium text-gray-900">{todos.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              data-testid="filter-all"
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'all'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('pending')}
              data-testid="filter-pending"
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'pending'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('in_progress')}
              data-testid="filter-in-progress"
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'in_progress'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              In Progress
            </button>
            <button
              onClick={() => setFilter('completed')}
              data-testid="filter-completed"
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === 'completed'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Completed
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4" data-testid="todo-list">
        {filteredTodos.map(todo => {
          const StatusIcon = statusConfig[todo.status].icon
          return (
            <div
              key={todo.id}
              data-testid="todo-item"
              className={`p-5 rounded-xl border transition-all ${
                todo.status === 'completed'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-white border-gray-200 hover:shadow-md'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3
                    className={`text-lg font-medium ${
                      todo.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'
                    }`}
                    data-testid="todo-item-title"
                  >
                    {todo.title}
                  </h3>
                  {todo.description && (
                    <p className="mt-1 text-gray-500 text-sm" data-testid="todo-item-description">
                      {todo.description}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    <select
                      value={todo.status}
                      onChange={e => handleStatusChange(todo, e.target.value as Todo['status'])}
                      data-testid="todo-status"
                      className={`px-3 py-1.5 text-sm rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none ${
                        statusConfig[todo.status].bg
                      }`}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                    <span className="text-xs text-gray-400">
                      {new Date(todo.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleExpand(todo.id)}
                    data-testid="toggle-attachments-button"
                    className={`p-2 rounded-lg transition-colors ${
                      expandedTodoId === todo.id
                        ? 'text-blue-500 bg-blue-50'
                        : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                    }`}
                    title="Toggle attachments"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <StatusIcon className={`w-6 h-6 ${statusConfig[todo.status].color}`} />
                  <button
                    onClick={() => handleDelete(todo.id)}
                    data-testid="delete-button"
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {expandedTodoId === todo.id && (
                <div
                  className="mt-4 pt-4 border-t border-gray-100"
                  data-testid="attachments-section"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700">Attachments</h4>
                    <label
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-500 hover:bg-blue-50 rounded-lg cursor-pointer transition-colors"
                      data-testid="upload-button"
                    >
                      <Upload className="w-4 h-4" />
                      Upload
                      <input
                        ref={el => {
                          if (el) fileInputRefs.current.set(todo.id, el)
                        }}
                        type="file"
                        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.json,.xlsx,.docx"
                        onChange={e => handleFileUpload(todo.id, e)}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {attachments.get(todo.id)?.length ? (
                    <div className="space-y-2">
                      {attachments.get(todo.id)?.map(attachment => (
                        <div
                          key={attachment.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                          data-testid="attachment-item"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <a
                              href={`/files/public/todos/${attachment.fileName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate flex-1"
                              title={attachment.originalName}
                            >
                              {attachment.originalName}
                            </a>
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              ({formatFileSize(attachment.size)})
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <a
                              href={`/files/public/todos/${attachment.fileName}`}
                              download={attachment.originalName}
                              className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors"
                              title="Download"
                              data-testid="download-attachment-button"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                            <button
                              onClick={() => handleDeleteAttachment(todo.id, attachment.id)}
                              className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                              data-testid="delete-attachment-button"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No attachments yet</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!loading && filteredTodos.length === 0 && (
        <EmptyState icon={Circle} title="No todos yet. Add one above!" className="py-12" />
      )}
    </div>
  )
}
