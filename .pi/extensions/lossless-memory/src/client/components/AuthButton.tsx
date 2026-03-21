import { useAuthStore } from '../stores/authStore'

export function AuthButton() {
  const { isAuthenticated, logout, setToken } = useAuthStore()

  const handleLogin = () => {
    // For development, use a test token
    // In production, this should call an actual login API
    const testToken = 'user-token'
    setToken(testToken)
    window.location.reload()
  }

  const handleLogout = () => {
    logout()
    window.location.reload()
  }

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">已登录</span>
        <button
          onClick={handleLogout}
          className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
        >
          退出
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleLogin}
      className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
    >
      登录
    </button>
  )
}
