import { Navigate, useLocation } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'
import { Role } from '@shared/modules/admin'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: Role
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const location = useLocation()
  const { isAuthenticated, user } = useAdminStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (requiredRole && user?.role !== requiredRole && user?.role !== Role.SUPER_ADMIN) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
