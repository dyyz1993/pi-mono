import { useState } from 'react'
import { apiClient } from '../services/apiClient'
import { Card, Button, Space, Input, message, Image, Typography, Divider, Progress } from 'antd'
import { Image as ImageIcon, FileCode, Download } from 'lucide-react'

const { Title, Paragraph, Text } = Typography

const TOTAL_LINES = 12

export const MediaTestPage: React.FC = () => {
  const [avatarId, setAvatarId] = useState('test-user')
  const [iconName, setIconName] = useState('home')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [loadingAvatar, setLoadingAvatar] = useState(false)
  const [loadingSvg, setLoadingSvg] = useState(false)
  const [streamProgress, setStreamProgress] = useState(0)
  const [streamLines, setStreamLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isDirectDownloading, setIsDirectDownloading] = useState(false)
  const [directProgress, setDirectProgress] = useState(0)
  const [directSpeed, setDirectSpeed] = useState('')

  const handleFetchAvatar = async () => {
    setLoadingAvatar(true)
    try {
      const blob = await apiClient.api.admin.avatar[':id'].$image({
        param: { id: avatarId },
      })
      const url = URL.createObjectURL(blob)
      setAvatarUrl(url)
      message.success('头像获取成功')
    } catch (error) {
      console.error('Failed to fetch avatar:', error)
      message.error('头像获取失败')
    } finally {
      setLoadingAvatar(false)
    }
  }

  const handleFetchSvg = async () => {
    setLoadingSvg(true)
    try {
      const svg = await apiClient.api.admin.icon[':name'].$svg({
        param: { name: iconName },
      })
      setSvgContent(svg)
      message.success('SVG 图标获取成功')
    } catch (error) {
      console.error('Failed to fetch SVG:', error)
      message.error('SVG 图标获取失败')
    } finally {
      setLoadingSvg(false)
    }
  }

  const handleStreamDownload = async () => {
    setIsStreaming(true)
    setStreamProgress(0)
    setStreamLines([])

    try {
      const response = await apiClient.api.admin.todos.export.stream.$get()
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let lineCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.trim())

        for (const line of lines) {
          lineCount++
          setStreamLines(prev => [...prev, line])
          setStreamProgress(Math.round((lineCount / TOTAL_LINES) * 100))
        }
      }

      message.success('流式导出完成！')
    } catch (error) {
      console.error('Failed to stream download:', error)
      message.error('流式导出失败')
    } finally {
      setIsStreaming(false)
    }
  }

  const handleBrowserStreamDownload = async () => {
    try {
      const win = window as unknown as {
        showSaveFilePicker: (options: {
          suggestedName: string
          types: Array<{ description: string; accept: Record<string, string[]> }>
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Uint8Array) => Promise<void>
            close: () => Promise<void>
          }>
        }>
      }
      const handle = await win.showSaveFilePicker({
        suggestedName: 'todos-stream.csv',
        types: [
          {
            description: 'CSV File',
            accept: { 'text/csv': ['.csv'] },
          },
        ],
      })

      const writable = await handle.createWritable()
      setIsStreaming(true)
      setStreamProgress(0)
      setStreamLines([])

      const response = await apiClient.api.admin.todos.export.stream.$get()
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let lineCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        await writable.write(value)

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.trim())

        for (const line of lines) {
          lineCount++
          setStreamLines(prev => [...prev, line])
          setStreamProgress(Math.round((lineCount / TOTAL_LINES) * 100))
        }
      }

      await writable.close()
      message.success('流式导出完成！请在浏览器下载管理器中查看进度')
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        message.info('用户取消了保存')
      } else {
        console.error('Failed to stream download:', error)
        message.error('流式导出失败')
      }
    } finally {
      setIsStreaming(false)
    }
  }

  const handleDirectDownload = async () => {
    setIsDirectDownloading(true)
    setDirectProgress(0)
    setDirectSpeed('')
    const startTime = Date.now()

    try {
      const response = await apiClient.api.admin.todos.export.$get()
      const contentLength = parseInt(response.headers.get('Content-Length') || '0')
      const reader = response.body?.getReader()

      if (!reader) {
        throw new Error('No response body')
      }

      const chunks: Uint8Array[] = []
      let receivedLength = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        receivedLength += value.length

        if (contentLength > 0) {
          const progress = Math.round((receivedLength / contentLength) * 100)
          setDirectProgress(progress)
        }

        const elapsed = (Date.now() - startTime) / 1000
        const speed = (receivedLength / 1024 / elapsed).toFixed(1)
        setDirectSpeed(`${speed} KB/s`)
      }

      const blob = new Blob(chunks)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'todos.csv'
      a.click()
      URL.revokeObjectURL(url)
      message.success('文件下载成功')
    } catch (error) {
      console.error('Failed to download:', error)
      message.error('文件下载失败')
    } finally {
      setIsDirectDownloading(false)
    }
  }

  const handleBrowserNativeDownload = async () => {
    try {
      const response = await apiClient.api.admin.todos.export.token.$post()
      const data = await response.json()

      if (!data.success || !data.data) {
        throw new Error('Failed to get download token')
      }

      const { downloadUrl } = data.data
      window.open(downloadUrl, '_blank')
      message.success('下载已开始，请在浏览器下载管理器中查看进度。关闭此页面不会中断下载！')
    } catch (error) {
      console.error('Failed to start download:', error)
      message.error('启动下载失败')
    }
  }

  const availableIcons = ['home', 'settings', 'user', 'bell']

  const supportsFileSystemAccess = 'showSaveFilePicker' in window

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Title level={2}>媒体类型测试</Title>
      <Paragraph>
        此页面演示如何使用 <Text code>$image()</Text>、<Text code>$svg()</Text> 和流式下载方法。
      </Paragraph>

      <Divider />

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card
          title={
            <Space>
              <ImageIcon size={20} />
              <span>图片测试 ($image)</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Paragraph>
              使用 <Text code>$image()</Text> 方法获取图片，返回{' '}
              <Text code>Promise&lt;Blob&gt;</Text>。
            </Paragraph>
            <Space>
              <Input
                placeholder="输入头像 ID"
                value={avatarId}
                onChange={e => setAvatarId(e.target.value)}
                style={{ width: 200 }}
              />
              <Button type="primary" onClick={handleFetchAvatar} loading={loadingAvatar}>
                获取头像
              </Button>
            </Space>
            {avatarUrl && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">获取结果：</Text>
                <div style={{ marginTop: 8 }}>
                  <Image
                    src={avatarUrl}
                    alt="Avatar"
                    width={128}
                    height={128}
                    style={{ borderRadius: '50%', border: '2px solid #1890ff' }}
                  />
                </div>
              </div>
            )}
          </Space>
        </Card>

        <Card
          title={
            <Space>
              <FileCode size={20} />
              <span>SVG 测试 ($svg)</span>
            </Space>
          }
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Paragraph>
              使用 <Text code>$svg()</Text> 方法获取 SVG 图标，返回{' '}
              <Text code>Promise&lt;string&gt;</Text>。
            </Paragraph>
            <Space wrap>
              {availableIcons.map(icon => (
                <Button
                  key={icon}
                  type={iconName === icon ? 'primary' : 'default'}
                  onClick={() => setIconName(icon)}
                >
                  {icon}
                </Button>
              ))}
            </Space>
            <Space>
              <Input
                placeholder="输入图标名称"
                value={iconName}
                onChange={e => setIconName(e.target.value)}
                style={{ width: 200 }}
              />
              <Button type="primary" onClick={handleFetchSvg} loading={loadingSvg}>
                获取 SVG
              </Button>
            </Space>
            {svgContent && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">获取结果：</Text>
                <div
                  style={{
                    marginTop: 8,
                    padding: 16,
                    background: '#f5f5f5',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                  }}
                >
                  <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    style={{
                      width: 48,
                      height: 48,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fff',
                      borderRadius: 8,
                      padding: 8,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      padding: 8,
                      background: '#fff',
                      borderRadius: 4,
                      fontFamily: 'monospace',
                      fontSize: 12,
                      overflow: 'auto',
                      maxHeight: 100,
                    }}
                  >
                    <code>{svgContent}</code>
                  </div>
                </div>
              </div>
            )}
          </Space>
        </Card>

        <Card
          title={
            <Space>
              <Download size={20} />
              <span>文件下载测试</span>
            </Space>
          }
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Paragraph>对比三种下载方式：</Paragraph>

            <Space wrap>
              <Button
                type="primary"
                icon={<Download size={16} />}
                onClick={handleDirectDownload}
                loading={isDirectDownloading}
              >
                直接下载 (页面内进度)
              </Button>
              <Button
                type="default"
                icon={<Download size={16} />}
                onClick={handleBrowserNativeDownload}
              >
                浏览器原生下载 (关闭页面继续)
              </Button>
              {supportsFileSystemAccess ? (
                <Button
                  type="default"
                  icon={<Download size={16} />}
                  onClick={handleBrowserStreamDownload}
                  loading={isStreaming}
                >
                  流式下载 (选择保存位置)
                </Button>
              ) : (
                <Button
                  type="default"
                  icon={<Download size={16} />}
                  onClick={handleStreamDownload}
                  loading={isStreaming}
                >
                  流式下载 (页面内进度)
                </Button>
              )}
            </Space>

            {isDirectDownloading && (
              <div style={{ marginTop: 16 }}>
                <Progress percent={directProgress} status="active" />
                <Text type="secondary">下载速度: {directSpeed || '计算中...'}</Text>
              </div>
            )}

            {isStreaming && (
              <div style={{ marginTop: 16 }}>
                <Progress percent={streamProgress} status="active" />
                <Text type="secondary">
                  正在接收数据... {streamLines.length}/{TOTAL_LINES} 行
                </Text>
              </div>
            )}

            {streamLines.length > 0 && !isStreaming && !supportsFileSystemAccess && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">接收到的数据 ({streamLines.length} 行)：</Text>
                <div
                  style={{
                    marginTop: 8,
                    padding: 12,
                    background: '#f5f5f5',
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {streamLines.map((line, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>
                      <Text type="secondary">{i + 1}:</Text> {line}
                    </div>
                  ))}
                </div>
                <Button
                  type="link"
                  onClick={() => {
                    const csv = streamLines.join('\n')
                    const blob = new Blob([csv], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'todos-stream.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  保存为文件
                </Button>
              </div>
            )}

            {supportsFileSystemAccess && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">
                  💡 流式下载使用 File System Access API，会在浏览器下载管理器中显示实时进度
                </Text>
              </div>
            )}
          </Space>
        </Card>

        <Card title="代码示例">
          <pre
            style={{
              background: '#f5f5f5',
              padding: 16,
              borderRadius: 8,
              overflow: 'auto',
            }}
          >
            {`// 获取图片 (返回 Blob)
const blob = await apiClient.api.admin.avatar[':id'].$image({
  param: { id: 'test-user' },
})
const imageUrl = URL.createObjectURL(blob)

// 获取 SVG (返回 string)
const svgString = await apiClient.api.admin.icon[':name'].$svg({
  param: { name: 'home' },
})

// 流式下载 - 使用 File System Access API (浏览器原生进度)
const handle = await window.showSaveFilePicker({
  suggestedName: 'todos.csv',
  types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
})
const writable = await handle.createWritable()

const response = await apiClient.api.admin.todos.export.stream.$get()
const reader = response.body?.getReader()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  await writable.write(value)  // 流式写入，浏览器显示进度
}

await writable.close()`}
          </pre>
        </Card>
      </Space>
    </div>
  )
}
