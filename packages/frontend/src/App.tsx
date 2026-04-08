import { useState, useEffect } from 'react'
import './App.css'

interface HelloResponse {
  message: string
}

function App() {
  const [message, setMessage] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchHello()
  }, [])

  const fetchHello = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/hello')
      const data: HelloResponse = await response.json()
      setMessage(data.message)
    } catch (error) {
      setMessage('Failed to fetch from backend')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>PI Project</h1>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <p>Backend says: {message}</p>
        )}
        <button onClick={fetchHello}>
          Refresh
        </button>
      </header>
    </div>
  )
}

export default App
