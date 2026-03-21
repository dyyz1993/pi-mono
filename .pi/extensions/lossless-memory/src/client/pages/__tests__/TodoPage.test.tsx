import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TodoPage } from '../TodoPage'
import type { Todo } from '@shared/schemas'

interface MockTodoStore {
  todos: Todo[]
  loading: boolean
  error: string | null
  fetchTodos: ReturnType<typeof vi.fn>
  createTodo: ReturnType<typeof vi.fn>
  updateTodo: ReturnType<typeof vi.fn>
  deleteTodo: ReturnType<typeof vi.fn>
}

const mockStore: MockTodoStore = {
  todos: [],
  loading: false,
  error: null,
  fetchTodos: vi.fn().mockResolvedValue(undefined),
  createTodo: vi.fn().mockResolvedValue(undefined),
  updateTodo: vi.fn().mockResolvedValue(undefined),
  deleteTodo: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../stores/todoStore', () => ({
  useTodoStore: vi.fn((selector?: (state: MockTodoStore) => unknown) => {
    if (selector) {
      return selector(mockStore)
    }
    return mockStore
  }),
}))

const createMockTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: 'Test Todo',
  description: 'Test description',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

describe('TodoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.todos = []
    mockStore.loading = false
    mockStore.error = null
  })

  describe('Initial Render', () => {
    it('should render page title', () => {
      render(<TodoPage />)
      expect(screen.getByTestId('todo-title')).toBeInTheDocument()
      expect(screen.getByText('Todo List')).toBeInTheDocument()
    })

    it('should render page description', () => {
      render(<TodoPage />)
      expect(screen.getByText(/CRUD operations/)).toBeInTheDocument()
    })

    it('should call fetchTodos on mount', () => {
      render(<TodoPage />)
      expect(mockStore.fetchTodos).toHaveBeenCalledTimes(1)
    })
  })

  describe('Create Todo Form', () => {
    it('should render form inputs', () => {
      render(<TodoPage />)
      expect(screen.getByTestId('todo-title-input')).toBeInTheDocument()
      expect(screen.getByTestId('todo-description-input')).toBeInTheDocument()
      expect(screen.getByTestId('add-todo-button')).toBeInTheDocument()
    })

    it('should have disabled submit button when title is empty', () => {
      render(<TodoPage />)
      const submitButton = screen.getByTestId('add-todo-button')
      expect(submitButton).toBeDisabled()
    })

    it('should enable submit button when title has value', () => {
      render(<TodoPage />)
      const titleInput = screen.getByTestId('todo-title-input')
      fireEvent.change(titleInput, { target: { value: 'New Todo' } })
      const submitButton = screen.getByTestId('add-todo-button')
      expect(submitButton).not.toBeDisabled()
    })

    it('should create todo on form submit', async () => {
      render(<TodoPage />)
      const titleInput = screen.getByTestId('todo-title-input')
      const descriptionInput = screen.getByTestId('todo-description-input')
      const submitButton = screen.getByTestId('add-todo-button')

      fireEvent.change(titleInput, { target: { value: 'New Todo' } })
      fireEvent.change(descriptionInput, { target: { value: 'New Description' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockStore.createTodo).toHaveBeenCalledWith({
          title: 'New Todo',
          description: 'New Description',
        })
      })
    })

    it('should clear form after successful submit', async () => {
      render(<TodoPage />)
      const titleInput = screen.getByTestId('todo-title-input') as HTMLInputElement
      const descriptionInput = screen.getByTestId('todo-description-input') as HTMLTextAreaElement
      const submitButton = screen.getByTestId('add-todo-button')

      fireEvent.change(titleInput, { target: { value: 'New Todo' } })
      fireEvent.change(descriptionInput, { target: { value: 'New Description' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(titleInput.value).toBe('')
        expect(descriptionInput.value).toBe('')
      })
    })
  })

  describe('Todo List Display', () => {
    it('should show loading indicator when loading', () => {
      mockStore.loading = true
      mockStore.todos = []
      render(<TodoPage />)
      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
    })

    it('should show error message when error exists', () => {
      mockStore.error = 'Failed to fetch todos'
      render(<TodoPage />)
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
      expect(screen.getByText('Failed to fetch todos')).toBeInTheDocument()
    })

    it('should display todo count', () => {
      mockStore.todos = [
        createMockTodo({ id: 1, title: 'Todo 1' }),
        createMockTodo({ id: 2, title: 'Todo 2' }),
      ]
      render(<TodoPage />)
      expect(screen.getByTestId('todo-count')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('should display todo items', () => {
      mockStore.todos = [
        createMockTodo({ id: 1, title: 'Test Todo 1' }),
        createMockTodo({ id: 2, title: 'Test Todo 2' }),
      ]
      render(<TodoPage />)
      expect(screen.getByText('Test Todo 1')).toBeInTheDocument()
      expect(screen.getByText('Test Todo 2')).toBeInTheDocument()
    })

    it('should display todo description when available', () => {
      mockStore.todos = [createMockTodo({ description: 'Test description' })]
      render(<TodoPage />)
      expect(screen.getByText('Test description')).toBeInTheDocument()
    })
  })

  describe('Filter Functionality', () => {
    beforeEach(() => {
      mockStore.todos = [
        createMockTodo({ id: 1, title: 'Pending Todo', status: 'pending' }),
        createMockTodo({ id: 2, title: 'In Progress Todo', status: 'in_progress' }),
        createMockTodo({ id: 3, title: 'Completed Todo', status: 'completed' }),
      ]
    })

    it('should render filter buttons', () => {
      render(<TodoPage />)
      expect(screen.getByTestId('filter-all')).toBeInTheDocument()
      expect(screen.getByTestId('filter-pending')).toBeInTheDocument()
      expect(screen.getByTestId('filter-in-progress')).toBeInTheDocument()
      expect(screen.getByTestId('filter-completed')).toBeInTheDocument()
    })

    it('should filter by pending status', () => {
      render(<TodoPage />)
      fireEvent.click(screen.getByTestId('filter-pending'))
      expect(screen.getByText('Pending Todo')).toBeInTheDocument()
      expect(screen.queryByText('In Progress Todo')).not.toBeInTheDocument()
      expect(screen.queryByText('Completed Todo')).not.toBeInTheDocument()
    })

    it('should filter by in_progress status', () => {
      render(<TodoPage />)
      fireEvent.click(screen.getByTestId('filter-in-progress'))
      expect(screen.queryByText('Pending Todo')).not.toBeInTheDocument()
      expect(screen.getByText('In Progress Todo')).toBeInTheDocument()
      expect(screen.queryByText('Completed Todo')).not.toBeInTheDocument()
    })

    it('should filter by completed status', () => {
      render(<TodoPage />)
      fireEvent.click(screen.getByTestId('filter-completed'))
      expect(screen.queryByText('Pending Todo')).not.toBeInTheDocument()
      expect(screen.queryByText('In Progress Todo')).not.toBeInTheDocument()
      expect(screen.getByText('Completed Todo')).toBeInTheDocument()
    })

    it('should show all todos when all filter is selected', () => {
      render(<TodoPage />)
      fireEvent.click(screen.getByTestId('filter-all'))
      expect(screen.getByText('Pending Todo')).toBeInTheDocument()
      expect(screen.getByText('In Progress Todo')).toBeInTheDocument()
      expect(screen.getByText('Completed Todo')).toBeInTheDocument()
    })
  })

  describe('Todo Actions', () => {
    it('should call updateTodo when status is changed', async () => {
      mockStore.todos = [createMockTodo({ id: 1, status: 'pending' })]
      render(<TodoPage />)
      const statusSelect = screen.getByTestId('todo-status')
      fireEvent.change(statusSelect, { target: { value: 'completed' } })
      await waitFor(() => {
        expect(mockStore.updateTodo).toHaveBeenCalledWith(1, { status: 'completed' })
      })
    })

    it('should call deleteTodo when delete button is clicked', async () => {
      mockStore.todos = [createMockTodo({ id: 1 })]
      render(<TodoPage />)
      const deleteButton = screen.getByTestId('delete-button')
      fireEvent.click(deleteButton)
      await waitFor(() => {
        expect(mockStore.deleteTodo).toHaveBeenCalledWith(1)
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no todos', () => {
      mockStore.todos = []
      render(<TodoPage />)
      expect(screen.getByText(/No todos yet/)).toBeInTheDocument()
    })
  })
})
