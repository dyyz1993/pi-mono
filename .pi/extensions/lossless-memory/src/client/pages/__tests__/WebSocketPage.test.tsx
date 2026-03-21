import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { WebSocketPage } from '../WebSocketPage'

const mockStore = {
  status: 'closed' as const,
  messages: [] as Array<{ type: string; payload: unknown; timestamp?: number }>,
  connect: vi.fn(),
  disconnect: vi.fn(),
  echo: vi.fn().mockResolvedValue(undefined),
  ping: vi.fn().mockResolvedValue(undefined),
  broadcast: vi.fn(),
  notification: vi.fn(),
  clearMessages: vi.fn(),
}

vi.mock('@client/stores/chatWSStore', () => ({
  useChatWsStore: vi.fn(() => mockStore),
}))

describe('WebSocketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.status = 'closed'
    mockStore.messages = []
  })

  describe('Initial Render', () => {
    it('should render page title', () => {
      render(<WebSocketPage />)
      expect(screen.getByText('WebSocket Demo')).toBeInTheDocument()
    })

    it('should render page description', () => {
      render(<WebSocketPage />)
      expect(screen.getByText(/WebSocket with type inference/)).toBeInTheDocument()
    })

    it('should show closed status by default', () => {
      render(<WebSocketPage />)
      expect(screen.getByText('Closed')).toBeInTheDocument()
    })
  })

  describe('Message Type Selector', () => {
    it('should render message type selector', () => {
      render(<WebSocketPage />)
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('should have echo selected by default', () => {
      render(<WebSocketPage />)
      const select = screen.getByRole('combobox')
      expect(select).toHaveValue('echo')
    })

    it('should change message type', () => {
      render(<WebSocketPage />)
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'ping' } })
      expect(select).toHaveValue('ping')
    })
  })

  describe('Send Message', () => {
    it('should not send message when disconnected', () => {
      render(<WebSocketPage />)
      const sendButton = screen.getByText('Send')
      expect(sendButton).toBeDisabled()
    })
  })

  describe('Empty State', () => {
    it('should display empty state when no messages', () => {
      render(<WebSocketPage />)
      expect(screen.getByText('No messages yet. Connect and send a message!')).toBeInTheDocument()
    })
  })

  describe('UI Elements', () => {
    it('should render connect button', () => {
      render(<WebSocketPage />)
      const connectButtons = screen.getAllByText('Connect')
      expect(connectButtons.length).toBeGreaterThan(0)
    })

    it('should render disconnect button', () => {
      render(<WebSocketPage />)
      const disconnectButtons = screen.getAllByText('Disconnect')
      expect(disconnectButtons.length).toBeGreaterThan(0)
    })

    it('should render clear button', () => {
      render(<WebSocketPage />)
      expect(screen.getByText('Clear')).toBeInTheDocument()
    })

    it('should render message input placeholder', () => {
      render(<WebSocketPage />)
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })
  })
})
