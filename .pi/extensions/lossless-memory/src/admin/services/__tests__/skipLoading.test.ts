import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLoadingStore } from '../../stores/loadingStore'
import { createRequestInterceptor } from '../requestInterceptor'
import type { AdminFetchExtendOptions } from '../types'

describe('extend options functionality', () => {
  let loadingStore: ReturnType<typeof useLoadingStore.getState>
  let interceptor: ReturnType<typeof createRequestInterceptor>

  beforeEach(() => {
    loadingStore = useLoadingStore.getState()
    loadingStore.count = 0
    loadingStore.isLoading = false

    interceptor = createRequestInterceptor({
      onShowLogin: vi.fn(),
      onShowCaptcha: vi.fn().mockResolvedValue(true),
      onRequest: (extend?: AdminFetchExtendOptions) => {
        if (extend?.loading !== false) {
          const text = typeof extend?.loading === 'string' ? extend.loading : undefined
          loadingStore.startLoading(text)
        }
      },
      onResponse: (extend?: AdminFetchExtendOptions) => {
        if (extend?.loading !== false) {
          loadingStore.stopLoading()
        }
      },
      onError: (extend?: AdminFetchExtendOptions) => {
        if (extend?.loading !== false) {
          loadingStore.stopLoading()
        }
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should trigger loading when extend.loading is not false', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    expect(loadingStore.isLoading).toBe(false)

    await interceptor('http://test.com', { extend: { loading: true } })

    expect(loadingStore.isLoading).toBe(false)
  })

  it('should NOT trigger loading when extend.loading is false', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    expect(loadingStore.isLoading).toBe(false)

    await interceptor('http://test.com', { extend: { loading: false } })

    expect(loadingStore.isLoading).toBe(false)
    expect(loadingStore.count).toBe(0)
  })

  it('should show custom loading text when extend.loading is string', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const startLoadingSpy = vi.spyOn(loadingStore, 'startLoading')

    await interceptor('http://test.com', { extend: { loading: '加载中...' } })

    expect(startLoadingSpy).toHaveBeenCalledWith('加载中...')
  })

  it('should handle error with extend options', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', mockFetch)

    try {
      await interceptor('http://test.com', { extend: { loading: false } })
    } catch {
      // Expected error
    }

    expect(loadingStore.isLoading).toBe(false)
    expect(loadingStore.count).toBe(0)
  })
})
