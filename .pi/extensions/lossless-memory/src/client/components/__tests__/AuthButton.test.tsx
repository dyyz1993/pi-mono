import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthButton } from '../AuthButton'

const mockSetToken = vi.fn()
const mockLogout = vi.fn()

// Mock zustand
vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn(selector => {
    // Return different values based on selector
    const state = {
      isAuthenticated: false,
      token: null,
      logout: mockLogout,
      setToken: mockSetToken,
    }
    if (selector) {
      return selector(state)
    }
    return state
  }),
}))

import { useAuthStore } from '../../stores/authStore'

describe('AuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: vi.fn() },
    })
  })

  it('should show login button when not authenticated', () => {
    vi.mocked(useAuthStore).mockImplementation(selector => {
      const state = {
        isAuthenticated: false,
        token: null,
        logout: mockLogout,
        setToken: mockSetToken,
      }
      return selector ? selector(state) : state
    })

    render(<AuthButton />)

    expect(screen.getByText('登录')).toBeInTheDocument()
    expect(screen.queryByText('退出')).not.toBeInTheDocument()
  })

  it('should show logout button when authenticated', () => {
    vi.mocked(useAuthStore).mockImplementation(selector => {
      const state = {
        isAuthenticated: true,
        token: 'user-token',
        logout: mockLogout,
        setToken: mockSetToken,
      }
      return selector ? selector(state) : state
    })

    render(<AuthButton />)

    expect(screen.getByText('已登录')).toBeInTheDocument()
    expect(screen.getByText('退出')).toBeInTheDocument()
    expect(screen.queryByText('登录')).not.toBeInTheDocument()
  })

  it('should call setToken and reload on login', () => {
    vi.mocked(useAuthStore).mockImplementation(selector => {
      const state = {
        isAuthenticated: false,
        token: null,
        logout: mockLogout,
        setToken: mockSetToken,
      }
      return selector ? selector(state) : state
    })

    render(<AuthButton />)

    fireEvent.click(screen.getByText('登录'))

    expect(mockSetToken).toHaveBeenCalledWith('user-token')
    expect(window.location.reload).toHaveBeenCalled()
  })

  it('should call logout and reload on logout', () => {
    vi.mocked(useAuthStore).mockImplementation(selector => {
      const state = {
        isAuthenticated: true,
        token: 'user-token',
        logout: mockLogout,
        setToken: mockSetToken,
      }
      return selector ? selector(state) : state
    })

    render(<AuthButton />)

    fireEvent.click(screen.getByText('退出'))

    expect(mockLogout).toHaveBeenCalled()
    expect(window.location.reload).toHaveBeenCalled()
  })
})
