import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import { App } from '../../App'

vi.mock('../../pages/TodoPage', () => ({
  TodoPage: () => <div data-testid="todo-page">Todo Page</div>,
}))

vi.mock('../../pages/NotificationPage', () => ({
  NotificationPage: () => <div data-testid="notification-page">Notification Page</div>,
}))

vi.mock('../../pages/WebSocketPage', () => ({
  WebSocketPage: () => <div data-testid="websocket-page">WebSocket Page</div>,
}))

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Initial Render', () => {
    it('should render title with correct text', () => {
      render(<App />)
      const titleElement = screen.getByTestId('app-title')
      expect(titleElement).toBeInTheDocument()
      expect(titleElement).toHaveTextContent('Biomimic App')
    })

    it('should render navigation', () => {
      render(<App />)
      expect(screen.getByTestId('app-nav')).toBeInTheDocument()
    })

    it('should render footer', () => {
      render(<App />)
      expect(screen.getByTestId('app-footer')).toBeInTheDocument()
    })
  })

  describe('Navigation Links', () => {
    it('should render todos nav link', () => {
      render(<App />)
      expect(screen.getByTestId('nav-todos-button')).toBeInTheDocument()
    })

    it('should render notifications nav link', () => {
      render(<App />)
      expect(screen.getByTestId('nav-notifications-button')).toBeInTheDocument()
    })

    it('should render websocket nav link', () => {
      render(<App />)
      expect(screen.getByTestId('nav-websocket-button')).toBeInTheDocument()
    })

    it('should render github link', () => {
      render(<App />)
      expect(screen.getByTestId('github-link')).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('should render main content area', () => {
      render(<App />)
      expect(screen.getByTestId('app-main')).toBeInTheDocument()
    })

    it('should render container', () => {
      render(<App />)
      expect(screen.getByTestId('app-container')).toBeInTheDocument()
    })
  })
})
