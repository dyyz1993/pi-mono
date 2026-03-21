import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '../Footer'

describe('Footer', () => {
  it('should render footer with copyright text', () => {
    render(<Footer />)

    expect(screen.getByText(/Built with/i)).toBeInTheDocument()
    expect(screen.getByText(/Hono RPC/i)).toBeInTheDocument()
    expect(screen.getByText(/React/i)).toBeInTheDocument()
    expect(screen.getByText(/TypeScript/i)).toBeInTheDocument()
  })

  it('should have correct styling classes', () => {
    const { container } = render(<Footer />)

    const footer = container.querySelector('footer')
    expect(footer).toHaveClass('bg-white')
    expect(footer).toHaveClass('border-t')
  })
})
