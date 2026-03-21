import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ConnectionStatus } from '../ConnectionStatus'

describe('ConnectionStatus', () => {
  const mockOnConnect = vi.fn()
  const mockOnDisconnect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render connection status container', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('connection-status')).toBeInTheDocument()
    })

    it('should render connect and disconnect buttons', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('connect-button')).toBeInTheDocument()
      expect(screen.getByTestId('disconnect-button')).toBeInTheDocument()
    })
  })

  describe('Status Display', () => {
    it('should show disconnected status when not connected', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
    })

    it('should show connected status when connected', () => {
      render(
        <ConnectionStatus
          connected={true}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('should show custom status text', () => {
      render(
        <ConnectionStatus
          connected={true}
          status="Reconnecting"
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByText('Reconnecting')).toBeInTheDocument()
    })
  })

  describe('Button States', () => {
    it('should disable connect button when connected', () => {
      render(
        <ConnectionStatus
          connected={true}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('connect-button')).toBeDisabled()
    })

    it('should enable connect button when disconnected', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('connect-button')).not.toBeDisabled()
    })

    it('should disable disconnect button when disconnected', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('disconnect-button')).toBeDisabled()
    })

    it('should enable disconnect button when connected', () => {
      render(
        <ConnectionStatus
          connected={true}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('disconnect-button')).not.toBeDisabled()
    })

    it('should disable connect button when loading', () => {
      render(
        <ConnectionStatus
          connected={false}
          loading={true}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      expect(screen.getByTestId('connect-button')).toBeDisabled()
    })
  })

  describe('Button Interactions', () => {
    it('should call onConnect when connect button is clicked', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      fireEvent.click(screen.getByTestId('connect-button'))
      expect(mockOnConnect).toHaveBeenCalledTimes(1)
    })

    it('should call onDisconnect when disconnect button is clicked', () => {
      render(
        <ConnectionStatus
          connected={true}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      fireEvent.click(screen.getByTestId('disconnect-button'))
      expect(mockOnDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loading State', () => {
    it('should show loading spinner when loading', () => {
      render(
        <ConnectionStatus
          connected={false}
          loading={true}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
        />
      )
      const container = screen.getByTestId('connection-status')
      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Custom ClassName', () => {
    it('should apply custom className', () => {
      render(
        <ConnectionStatus
          connected={false}
          onConnect={mockOnConnect}
          onDisconnect={mockOnDisconnect}
          className="custom-class"
        />
      )
      expect(screen.getByTestId('connection-status')).toHaveClass('custom-class')
    })
  })
})
