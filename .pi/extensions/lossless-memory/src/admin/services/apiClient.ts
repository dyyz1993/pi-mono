/**
 * @framework-baseline ab16e97716a7556e
 */

import { hc } from 'hono/client'
import { WSClientImpl } from '@shared/core/ws-client'
import { SSEClientImpl } from '@shared/core/sse-client'
import { createRequestInterceptor } from './requestInterceptor'
import type { AdminFetchExtendOptions } from './types'
import { useCaptchaStore } from '../stores/captchaStore'
import { useLoadingStore } from '../stores/loadingStore'
import type { AdminApiType } from '@server/index'

const baseUrl = import.meta.env.API_BASE_URL || window.location.origin

const TOKEN_KEY = 'admin-storage'

function clearAuthAndRedirect(): void {
  localStorage.removeItem(TOKEN_KEY)
  if (window.location.pathname !== '/admin/login') {
    window.location.href = '/admin/login'
  }
}

function getAuthToken(): string | null {
  try {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return parsed.state?.token || null
    }
  } catch {
    return null
  }
  return null
}

function createCustomFetch() {
  const showCaptcha = useCaptchaStore.getState().show
  const { startLoading, stopLoading } = useLoadingStore.getState()

  return createRequestInterceptor({
    onShowLogin: clearAuthAndRedirect,
    onShowCaptcha: async config => {
      return showCaptcha({
        type: config.type,
        captchaUrl: config.captchaUrl,
      })
    },
    onRequest: (extend?: AdminFetchExtendOptions) => {
      if (extend?.loading !== false) {
        const text = typeof extend?.loading === 'string' ? extend.loading : undefined
        startLoading(text)
      }
    },
    onResponse: (extend?: AdminFetchExtendOptions) => {
      if (extend?.loading !== false) {
        stopLoading()
      }
    },
    onError: (extend?: AdminFetchExtendOptions) => {
      if (extend?.loading !== false) {
        stopLoading()
      }
    },
  })
}

export const apiClient = hc<AdminApiType>(baseUrl, {
  fetch: createCustomFetch() as typeof fetch,
  webSocket: url => new WSClientImpl(url),
  sse: url => {
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return new SSEClientImpl(url, headers)
  },
})
