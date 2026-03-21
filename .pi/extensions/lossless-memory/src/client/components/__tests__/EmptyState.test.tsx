import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { EmptyState } from '../EmptyState'
import { Inbox, FileX, Search } from 'lucide-react'

describe('EmptyState', () => {
  describe('Rendering', () => {
    it('should render with icon and title', () => {
      render(<EmptyState icon={Inbox} title="No items" />)
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(screen.getByText('No items')).toBeInTheDocument()
    })

    it('should render with description', () => {
      render(
        <EmptyState
          icon={Inbox}
          title="No items"
          description="Add your first item to get started"
        />
      )
      expect(screen.getByText('Add your first item to get started')).toBeInTheDocument()
    })

    it('should render without description', () => {
      render(<EmptyState icon={Inbox} title="No items" />)
      expect(screen.getByText('No items')).toBeInTheDocument()
    })
  })

  describe('Icon Display', () => {
    it('should display the provided icon', () => {
      render(<EmptyState icon={FileX} title="File not found" />)
      const container = screen.getByTestId('empty-state')
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should apply correct icon size', () => {
      render(<EmptyState icon={Search} title="No results" />)
      const container = screen.getByTestId('empty-state')
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('w-16', 'h-16')
    })

    it('should apply correct icon color', () => {
      render(<EmptyState icon={Inbox} title="Empty" />)
      const container = screen.getByTestId('empty-state')
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-gray-300')
    })
  })

  describe('Custom ClassName', () => {
    it('should apply custom className', () => {
      render(<EmptyState icon={Inbox} title="Empty" className="custom-class" />)
      const container = screen.getByTestId('empty-state')
      expect(container).toHaveClass('custom-class')
    })
  })

  describe('Layout', () => {
    it('should have flex column layout', () => {
      render(<EmptyState icon={Inbox} title="Empty" />)
      const container = screen.getByTestId('empty-state')
      expect(container).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center')
    })
  })
})
