import { Button, Card, Space, Divider, Alert, message } from 'antd'
import { apiClient } from '../services/apiClient'
import { useState } from 'react'

export const TestCaptchaPage: React.FC = () => {
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const testNormalRequest = async () => {
    setLoading(true)
    try {
      const response = await apiClient.api.admin.stats.$get()
      const data = await response.json()
      setResult(`✅ 正常请求成功:\n${JSON.stringify(data, null, 2)}`)
      message.success('正常请求成功')
    } catch (error) {
      setResult(`❌ 请求失败: ${error}`)
      message.error('请求失败')
    } finally {
      setLoading(false)
    }
  }

  const testCaptchaTrigger = async () => {
    setLoading(true)
    try {
      for (let i = 0; i < 15; i++) {
        await apiClient.api.admin.stats.$get()
      }
      setResult('✅ 触发限流验证码测试完成')
      message.success('已触发多次请求，应该会显示验证码')
    } catch (error) {
      setResult(`❌ 请求失败: ${error}`)
      message.error('请求失败')
    } finally {
      setLoading(false)
    }
  }

  const testConcurrentRequests = async () => {
    setLoading(true)
    try {
      const promises = Array.from({ length: 5 }, () => apiClient.api.admin.stats.$get())

      const responses = await Promise.all(promises)
      const results = await Promise.all(
        responses.map(
          async (r: Awaited<ReturnType<typeof apiClient.api.admin.stats.$get>>) => await r.json()
        )
      )

      setResult(`✅ 并发请求全部成功:\n${JSON.stringify(results, null, 2)}`)
      message.success('并发请求测试成功')
    } catch (error) {
      setResult(`❌ 并发请求失败: ${error}`)
      message.error('并发请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Card title="🧪 验证码拦截器测试" className="mb-4">
        <Alert
          message="测试说明"
          description={
            <div>
              <p>此页面用于测试请求拦截器的各种场景：</p>
              <ul className="list-disc list-inside mt-2">
                <li>
                  <strong>正常请求</strong>：不触发任何拦截
                </li>
                <li>
                  <strong>限流触发</strong>：连续请求 15 次触发验证码
                </li>
                <li>
                  <strong>并发请求</strong>：同时发送多个请求测试排队
                </li>
              </ul>
            </div>
          }
          type="info"
          showIcon
          className="mb-4"
        />

        <Space direction="vertical" className="w-full" size="middle">
          <Divider orientation="left">基础测试</Divider>

          <Button type="primary" onClick={testNormalRequest} loading={loading} block size="large">
            ✅ 测试正常请求（无拦截）
          </Button>

          <Button type="default" onClick={testCaptchaTrigger} loading={loading} block size="large">
            🔐 测试限流触发验证码（连续请求 15 次）
          </Button>

          <Divider orientation="left">高级测试</Divider>

          <Button
            type="dashed"
            onClick={testConcurrentRequests}
            loading={loading}
            block
            size="large"
          >
            🔄 测试并发请求（同时发送 5 个请求）
          </Button>
        </Space>
      </Card>

      {result && (
        <Card title="📋 测试结果">
          <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-96 text-sm">{result}</pre>
        </Card>
      )}
    </div>
  )
}
