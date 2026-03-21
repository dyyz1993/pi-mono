import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LoadingSpinner } from '../LoadingSpinner'

describe('LoadingSpinner', () => {
  describe('Rendering', () => {
    it('should render spinner element', () => {
      render(<LoadingSpinner />)
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    })
  })

  describe('Sizes', () => {
    it('should apply small size by default', () => {
      render(<LoadingSpinner size="sm" />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('w-4', 'h-4')
    })

    it('should apply medium size by default', () => {
      render(<LoadingSpinner size="md" />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('w-6', 'h-6')
    })

    it('should apply large size', () => {
      render(<LoadingSpinner size="lg" />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('w-8', 'h-8')
    })

    it('should use medium size by default', () => {
      render(<LoadingSpinner />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('w-6', 'h-6')
    })
  })

  describe('Colors', () => {
    it('should apply blue color by default', () => {
      render(<LoadingSpinner />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('text-blue-500')
    })

    it('should apply custom color', () => {
      render(<LoadingSpinner color="text-red-500" />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('text-red-500')
    })

    it('should apply green color', () => {
      render(<LoadingSpinner color="text-green-500" />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('text-green-500')
    })
  })

  describe('Animation', () => {
    it('should have animate-spin class', () => {
      render(<LoadingSpinner />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('animate-spin')
    })
  })

  describe('Custom ClassName', () => {
    it('should apply custom className', () => {
      render(<LoadingSpinner className="custom-class" />)
      const spinner = screen.getByTestId('loading-spinner')
      expect(spinner).toHaveClass('custom-class')
    })
  })
})
