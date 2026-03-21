import type { AdminFetchExtendOptions, InterceptorCallbacks } from './types'

type PendingRequest = {
  resolve: (value: Response) => void
  reject: (error: Error) => void
  request: () => Promise<Response>
}

export class RequestInterceptor {
  private pendingRequests: PendingRequest[] = []
  private isShowingCaptcha = false

  constructor(private callbacks: InterceptorCallbacks) {}

  async intercept(
    url: string,
    init: RequestInit & { extend?: AdminFetchExtendOptions }
  ): Promise<Response> {
    const extend = init.extend
    const request = () => this.executeRequest(url, init)

    if (this.isShowingCaptcha) {
      return new Promise((resolve, reject) => {
        this.pendingRequests.push({ resolve, reject, request })
      })
    }

    this.callbacks.onRequest?.(extend)
    try {
      const response = await request()
      this.callbacks.onResponse?.(extend)
      return this.handleResponseStatus(response, request, extend)
    } catch (error) {
      this.callbacks.onError?.(extend)
      throw error
    }
  }

  private async executeRequest(
    url: string,
    init: RequestInit & { extend?: AdminFetchExtendOptions }
  ): Promise<Response> {
    const token = this.getStoredToken()
    const headers = new Headers(init.headers)

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const restInit = { ...init }
    delete restInit.extend

    return window.fetch(url, {
      ...restInit,
      headers,
    })
  }

  private async handleResponseStatus(
    response: Response,
    retryRequest: () => Promise<Response>,
    extend?: AdminFetchExtendOptions
  ): Promise<Response> {
    if (response.status === 401) {
      this.callbacks.onShowLogin()
      throw new Error('Unauthorized')
    }

    if (this.shouldShowCaptcha(response)) {
      return this.handleCaptcha(retryRequest, extend)
    }

    return response
  }

  private shouldShowCaptcha(response: Response): boolean {
    return response.status === 403 || response.status === 429
  }

  private async handleCaptcha(
    retryRequest: () => Promise<Response>,
    extend?: AdminFetchExtendOptions
  ): Promise<Response> {
    if (this.isShowingCaptcha) {
      return new Promise((resolve, reject) => {
        this.pendingRequests.push({ resolve, reject, request: retryRequest })
      })
    }

    this.isShowingCaptcha = true

    try {
      const success = await this.callbacks.onShowCaptcha({
        type: 'image',
        captchaUrl: '/api/captcha',
      })

      if (success) {
        this.callbacks.onRequest?.(extend)
        const response = await retryRequest()
        this.callbacks.onResponse?.(extend)
        await this.processPendingRequests()
        return response
      } else {
        throw new Error('Captcha verification failed')
      }
    } catch (error) {
      this.callbacks.onError?.(extend)
      throw error
    } finally {
      this.isShowingCaptcha = false
    }
  }

  private async processPendingRequests(): Promise<void> {
    const requests = [...this.pendingRequests]
    this.pendingRequests = []

    await Promise.all(
      requests.map(async ({ resolve, reject, request }) => {
        try {
          this.callbacks.onRequest?.()
          const response = await request()
          this.callbacks.onResponse?.()
          resolve(response)
        } catch (error) {
          this.callbacks.onError?.()
          reject(error as Error)
        }
      })
    )
  }

  private getStoredToken(): string | null {
    try {
      const stored = localStorage.getItem('admin-storage')
      if (stored) {
        const parsed = JSON.parse(stored)
        return parsed.state?.token || null
      }
    } catch {
      return null
    }
    return null
  }
}

export function createRequestInterceptor(callbacks: InterceptorCallbacks) {
  const interceptor = new RequestInterceptor(callbacks)
  return (url: string, init: RequestInit & { extend?: AdminFetchExtendOptions }) =>
    interceptor.intercept(url, init)
}
