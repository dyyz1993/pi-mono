import { Modal, Input, Button, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useState, useEffect } from 'react'
import { useCaptchaStore } from '../stores/captchaStore'

interface CaptchaData {
  id: string
  image: string
}

export const CaptchaModal: React.FC = () => {
  const { isOpen, resolve } = useCaptchaStore()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [captchaData, setCaptchaData] = useState<CaptchaData | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchCaptcha = async () => {
    setRefreshing(true)
    try {
      const response = await window.fetch('/api/captcha')
      const result = (await response.json()) as { success: boolean; data?: CaptchaData }

      if (result.success && result.data) {
        setCaptchaData(result.data)
      } else {
        message.error('获取验证码失败')
      }
    } catch {
      message.error('获取验证码失败')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchCaptcha()
      setCode('')
    }
  }, [isOpen])

  const handleRefresh = () => {
    fetchCaptcha()
  }

  const handleSubmit = async () => {
    if (!code.trim()) {
      message.warning('请输入验证码')
      return
    }

    if (!captchaData) {
      message.warning('验证码未加载，请刷新')
      return
    }

    setLoading(true)
    try {
      const response = await window.fetch('/api/verify-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: captchaData.id,
          code,
        }),
      })

      const result = (await response.json()) as { success: boolean; error?: string }

      if (result.success) {
        message.success('验证成功')
        resolve(true)
        setCode('')
        setCaptchaData(null)
      } else {
        message.error(result.error || '验证失败')
        handleRefresh()
      }
    } catch {
      message.error('验证失败，请重试')
      handleRefresh()
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setCode('')
    setCaptchaData(null)
    resolve(false)
  }

  return (
    <Modal
      open={isOpen}
      title="请完成安全验证"
      onCancel={handleCancel}
      footer={null}
      maskClosable={false}
      closable={true}
      width={400}
    >
      <div className="space-y-4">
        <div className="relative">
          {captchaData?.image ? (
            <img
              src={captchaData.image}
              alt="验证码"
              className="w-full h-32 object-cover border rounded cursor-pointer"
              onClick={handleRefresh}
            />
          ) : (
            <div className="w-full h-32 border rounded flex items-center justify-center bg-gray-50">
              {refreshing ? '加载中...' : '点击刷新验证码'}
            </div>
          )}
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={refreshing}
            className="absolute top-2 right-2"
            title="刷新验证码"
          />
        </div>

        <Input
          placeholder="请输入验证码"
          value={code}
          onChange={e => setCode(e.target.value)}
          onPressEnter={handleSubmit}
          size="large"
          disabled={!captchaData}
        />

        <div className="flex gap-2">
          <Button onClick={handleCancel} className="flex-1">
            取消
          </Button>
          <Button
            type="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={!captchaData}
            className="flex-1"
          >
            提交
          </Button>
        </div>
      </div>
    </Modal>
  )
}
