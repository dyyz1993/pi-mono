import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MessageCard } from '../MessageCard'
import { Send } from 'lucide-react'

describe('MessageCard', () => {
  describe('Rendering', () => {
    it('should render message card container', () => {
      render(<MessageCard type="test" payload={{ message: 'hello' }} />)
      expect(screen.getByTestId('message-card')).toBeInTheDocument()
    })

    it('should render message type', () => {
      render(<MessageCard type="echo" payload={{ message: 'hello' }} />)
      expect(screen.getByText('ECHO')).toBeInTheDocument()
    })

    it('should convert underscore type to spaced format', () => {
      render(<MessageCard type="echo_request" payload={{ message: 'hello' }} />)
      expect(screen.getByText('ECHO REQUEST')).toBeInTheDocument()
    })

    it('should render payload as JSON', () => {
      render(<MessageCard type="test" payload={{ key: 'value', count: 42 }} />)
      expect(screen.getByText(/"key"/)).toBeInTheDocument()
      expect(screen.getByText(/"value"/)).toBeInTheDocument()
      expect(screen.getByText(/"count"/)).toBeInTheDocument()
      expect(screen.getByText(/42/)).toBeInTheDocument()
    })
  })

  describe('Timestamp', () => {
    it('should render timestamp when provided', () => {
      const timestamp = new Date('2024-01-15T10:30:00').getTime()
      render(<MessageCard type="test" payload={{}} timestamp={timestamp} />)
      expect(screen.getByText(/10:30/)).toBeInTheDocument()
    })

    it('should not render timestamp when not provided', () => {
      render(<MessageCard type="test" payload={{}} />)
      const card = screen.getByTestId('message-card')
      const timeElement = card.querySelector('.text-gray-400.text-xs')
      expect(timeElement).not.toBeInTheDocument()
    })
  })

  describe('Icon Display', () => {
    it('should display icon when provided', () => {
      render(<MessageCard type="test" payload={{}} icon={Send} />)
      const card = screen.getByTestId('message-card')
      const icon = card.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should not display icon when not provided', () => {
      render(<MessageCard type="test" payload={{}} />)
      const badge = screen.getByText('TEST')
      const icon = badge.querySelector('svg')
      expect(icon).not.toBeInTheDocument()
    })
  })

  describe('Color Schemes', () => {
    it('should apply gray color scheme by default', () => {
      render(<MessageCard type="test" payload={{}} />)
      const badge = screen.getByText('TEST')
      expect(badge).toHaveClass('bg-gray-500')
    })

    it('should apply cyan color scheme', () => {
      render(<MessageCard type="ping" payload={{}} colorScheme="cyan" />)
      const badge = screen.getByText('PING')
      expect(badge).toHaveClass('bg-cyan-500')
    })

    it('should apply purple color scheme', () => {
      render(<MessageCard type="echo" payload={{}} colorScheme="purple" />)
      const badge = screen.getByText('ECHO')
      expect(badge).toHaveClass('bg-purple-500')
    })

    it('should apply orange color scheme', () => {
      render(<MessageCard type="broadcast" payload={{}} colorScheme="orange" />)
      const badge = screen.getByText('BROADCAST')
      expect(badge).toHaveClass('bg-orange-500')
    })

    it('should apply green color scheme', () => {
      render(<MessageCard type="notification" payload={{}} colorScheme="green" />)
      const badge = screen.getByText('NOTIFICATION')
      expect(badge).toHaveClass('bg-green-500')
    })
  })

  describe('Border Color', () => {
    it('should apply custom border color via style', () => {
      render(<MessageCard type="test" payload={{}} borderColor="#ff0000" />)
      const card = screen.getByTestId('message-card')
      expect(card).toHaveStyle({ borderLeftColor: '#ff0000' })
    })
  })

  describe('Custom ClassName', () => {
    it('should apply custom className', () => {
      render(<MessageCard type="test" payload={{}} className="custom-class" />)
      expect(screen.getByTestId('message-card')).toHaveClass('custom-class')
    })
  })

  describe('Complex Payloads', () => {
    it('should render nested objects', () => {
      render(
        <MessageCard
          type="test"
          payload={{
            user: {
              name: 'John',
              age: 30,
            },
            items: [1, 2, 3],
          }}
        />
      )
      expect(screen.getByText(/"user"/)).toBeInTheDocument()
      expect(screen.getByText(/"name"/)).toBeInTheDocument()
      expect(screen.getByText(/"John"/)).toBeInTheDocument()
    })

    it('should render arrays', () => {
      render(<MessageCard type="test" payload={[1, 2, 3]} />)
      expect(screen.getByText(/1/)).toBeInTheDocument()
      expect(screen.getByText(/2/)).toBeInTheDocument()
      expect(screen.getByText(/3/)).toBeInTheDocument()
    })

    it('should render primitive values', () => {
      render(<MessageCard type="test" payload="simple string" />)
      expect(screen.getByText(/"simple string"/)).toBeInTheDocument()
    })
  })
})
