import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { StatusBadge } from '../StatusBadge'
import { CheckCircle, AlertTriangle } from 'lucide-react'

describe('StatusBadge', () => {
  describe('Rendering', () => {
    it('should render with label', () => {
      render(<StatusBadge label="Test Badge" />)
      expect(screen.getByTestId('status-badge')).toBeInTheDocument()
      expect(screen.getByText('Test Badge')).toBeInTheDocument()
    })

    it('should render with icon', () => {
      render(<StatusBadge label="Success" icon={CheckCircle} />)
      expect(screen.getByTestId('status-badge')).toBeInTheDocument()
      expect(screen.getByText('Success')).toBeInTheDocument()
    })

    it('should render without icon', () => {
      render(<StatusBadge label="No Icon" />)
      expect(screen.getByTestId('status-badge')).toBeInTheDocument()
      expect(screen.getByText('No Icon')).toBeInTheDocument()
    })
  })

  describe('Color Schemes', () => {
    it('should apply gray color scheme by default', () => {
      render(<StatusBadge label="Default" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-gray-500')
    })

    it('should apply blue color scheme', () => {
      render(<StatusBadge label="Blue" colorScheme="blue" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-blue-500')
    })

    it('should apply green color scheme', () => {
      render(<StatusBadge label="Green" colorScheme="green" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-green-500')
    })

    it('should apply red color scheme', () => {
      render(<StatusBadge label="Red" colorScheme="red" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-red-500')
    })

    it('should apply yellow color scheme', () => {
      render(<StatusBadge label="Yellow" colorScheme="yellow" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-yellow-500')
    })

    it('should apply purple color scheme', () => {
      render(<StatusBadge label="Purple" colorScheme="purple" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-purple-500')
    })

    it('should apply orange color scheme', () => {
      render(<StatusBadge label="Orange" colorScheme="orange" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-orange-500')
    })

    it('should apply cyan color scheme', () => {
      render(<StatusBadge label="Cyan" colorScheme="cyan" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-cyan-500')
    })

    it('should apply indigo color scheme', () => {
      render(<StatusBadge label="Indigo" colorScheme="indigo" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('bg-indigo-500')
    })
  })

  describe('Custom ClassName', () => {
    it('should apply custom className', () => {
      render(<StatusBadge label="Custom" className="custom-class" />)
      const badge = screen.getByTestId('status-badge')
      expect(badge).toHaveClass('custom-class')
    })
  })

  describe('Icon Display', () => {
    it('should display icon when provided', () => {
      render(<StatusBadge label="With Icon" icon={AlertTriangle} />)
      const badge = screen.getByTestId('status-badge')
      const icon = badge.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should not display icon when not provided', () => {
      render(<StatusBadge label="No Icon" />)
      const badge = screen.getByTestId('status-badge')
      const icon = badge.querySelector('svg')
      expect(icon).not.toBeInTheDocument()
    })
  })
})
