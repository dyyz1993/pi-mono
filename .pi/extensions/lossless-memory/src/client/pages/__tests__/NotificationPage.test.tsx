import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { NotificationPage } from '../NotificationPage'
import type { AppNotification } from '@shared/schemas'

interface MockNotificationStore {
  notifications: AppNotification[]
  unreadCount: number
  sseConnected: boolean
  loading: boolean
  error: string | null
  fetchNotifications: ReturnType<typeof vi.fn>
  createNotification: ReturnType<typeof vi.fn>
  markAsRead: ReturnType<typeof vi.fn>
  markAllAsRead: ReturnType<typeof vi.fn>
  deleteNotification: ReturnType<typeof vi.fn>
  connectSSE: ReturnType<typeof vi.fn>
  disconnectSSE: ReturnType<typeof vi.fn>
}

const mockStore: MockNotificationStore = {
  notifications: [],
  unreadCount: 0,
  sseConnected: false,
  loading: false,
  error: null,
  fetchNotifications: vi.fn(),
  createNotification: vi.fn().mockResolvedValue(undefined),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  deleteNotification: vi.fn(),
  connectSSE: vi.fn(),
  disconnectSSE: vi.fn(),
}

vi.mock('../../stores/notificationStore', () => ({
  useNotificationStore: vi.fn((selector?: (state: MockNotificationStore) => unknown) => {
    if (selector) {
      return selector(mockStore)
    }
    return mockStore
  }),
}))

const createMockNotification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  type: 'info',
  title: 'Test Notification',
  message: 'Test message',
  read: false,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('NotificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.notifications = []
    mockStore.unreadCount = 0
    mockStore.sseConnected = false
    mockStore.loading = false
    mockStore.error = null
  })

  describe('Initial Render', () => {
    it('should render page title', () => {
      render(<NotificationPage />)
      expect(screen.getByText('Notifications')).toBeInTheDocument()
    })

    it('should render page description', () => {
      render(<NotificationPage />)
      expect(screen.getByText(/SSE \(Server-Sent Events\)/)).toBeInTheDocument()
    })

    it('should call fetchNotifications on mount', () => {
      render(<NotificationPage />)
      expect(mockStore.fetchNotifications).toHaveBeenCalledTimes(1)
    })
  })

  describe('SSE Connection Status', () => {
    it('should show disconnected status by default', () => {
      render(<NotificationPage />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
    })

    it('should show connected status when SSE is connected', () => {
      mockStore.sseConnected = true
      render(<NotificationPage />)
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('should call connectSSE when connect button is clicked', () => {
      render(<NotificationPage />)
      const connectButtons = screen.getAllByText('Connect')
      fireEvent.click(connectButtons[0])
      expect(mockStore.connectSSE).toHaveBeenCalledTimes(1)
    })

    it('should call disconnectSSE when disconnect button is clicked', () => {
      mockStore.sseConnected = true
      render(<NotificationPage />)
      const disconnectButtons = screen.getAllByText('Disconnect')
      fireEvent.click(disconnectButtons[0])
      expect(mockStore.disconnectSSE).toHaveBeenCalledTimes(1)
    })
  })

  describe('Unread Count', () => {
    it('should display unread count', () => {
      mockStore.unreadCount = 5
      render(<NotificationPage />)
      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  describe('Create Notification Form', () => {
    it('should render form inputs', () => {
      render(<NotificationPage />)
      expect(screen.getByPlaceholderText('Title...')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Message...')).toBeInTheDocument()
    })

    it('should render type selector', () => {
      render(<NotificationPage />)
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should have info type selected by default', () => {
      render(<NotificationPage />)
      const select = screen.getByRole('combobox')
      expect(select).toHaveValue('info')
    })

    it('should create notification on form submit', async () => {
      render(<NotificationPage />)

      const titleInput = screen.getByPlaceholderText('Title...')
      const messageInput = screen.getByPlaceholderText('Message...')
      const submitButton = screen.getByText('Create Notification')

      fireEvent.change(titleInput, { target: { value: 'Test Title' } })
      fireEvent.change(messageInput, { target: { value: 'Test Message' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockStore.createNotification).toHaveBeenCalledWith({
          type: 'info',
          title: 'Test Title',
          message: 'Test Message',
        })
      })
    })

    it('should not create notification with empty fields', () => {
      render(<NotificationPage />)

      const submitButton = screen.getByText('Create Notification')
      fireEvent.click(submitButton)

      expect(mockStore.createNotification).not.toHaveBeenCalled()
    })
  })

  describe('Notification List', () => {
    it('should display notifications when available', () => {
      mockStore.notifications = [
        createMockNotification({ title: 'Test Notification', message: 'Test message' }),
      ]

      render(<NotificationPage />)
      expect(screen.getByText('Test Notification')).toBeInTheDocument()
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    it('should display notification type badge', () => {
      mockStore.notifications = [
        createMockNotification({ type: 'warning', title: 'Warning', message: 'Warning message' }),
      ]

      render(<NotificationPage />)
      expect(screen.getByText('WARNING')).toBeInTheDocument()
    })

    it('should call markAsRead when mark as read button is clicked', () => {
      mockStore.notifications = [
        createMockNotification({ id: '123e4567-e89b-12d3-a456-426614174001' }),
      ]

      render(<NotificationPage />)
      const markReadButton = screen.getByTitle('Mark as read')
      fireEvent.click(markReadButton)

      expect(mockStore.markAsRead).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174001')
    })

    it('should call deleteNotification when delete button is clicked', () => {
      mockStore.notifications = [
        createMockNotification({ id: '123e4567-e89b-12d3-a456-426614174002' }),
      ]

      render(<NotificationPage />)
      const deleteButtons = screen.getAllByRole('button')
      const deleteButton = deleteButtons.find(btn => btn.querySelector('svg.lucide-trash-2'))
      fireEvent.click(deleteButton!)

      expect(mockStore.deleteNotification).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174002'
      )
    })

    it('should call markAllAsRead when mark all read button is clicked', () => {
      render(<NotificationPage />)
      const markAllButton = screen.getByText('Mark All Read')
      fireEvent.click(markAllButton)

      expect(mockStore.markAllAsRead).toHaveBeenCalledTimes(1)
    })
  })

  describe('Empty State', () => {
    it('should display empty state when no notifications', () => {
      render(<NotificationPage />)
      expect(screen.getByText('No notifications yet. Create one above!')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should display error message when error exists', () => {
      mockStore.error = 'Test error message'
      render(<NotificationPage />)
      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should show loading spinner when creating notification', () => {
      mockStore.loading = true
      render(<NotificationPage />)
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })
})
