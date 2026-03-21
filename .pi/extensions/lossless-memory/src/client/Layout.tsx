import { ReactNode } from 'react'
import { Navigation } from './components/Navigation'
import { Footer } from './components/Footer'

interface LayoutProps {
  children: ReactNode
  className?: string
  showNavigation?: boolean
  showFooter?: boolean
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  className = '',
  showNavigation = true,
  showFooter = true,
}) => {
  return (
    <div className={`min-h-screen bg-gray-50 ${className}`} data-testid="app-container">
      {showNavigation && <Navigation />}
      <main className="py-8" data-testid="app-main">
        {children}
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
