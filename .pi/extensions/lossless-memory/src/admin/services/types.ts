/**
 * 管理后台请求扩展参数
 */
export interface AdminFetchExtendOptions {
  /** Loading 控制：true 显示默认 loading，string 显示自定义文字 */
  loading?: boolean | string
  /** 重试次数 */
  retry?: number
  /** 重试延迟 */
  retryDelay?: number
  /** 静默错误，不显示错误提示 */
  silentError?: boolean
  /** 超时时间 */
  timeout?: number
}

export type CaptchaType = 'iframe' | 'image'

export type AdminFetch = (
  url: string,
  init: RequestInit & { extend?: AdminFetchExtendOptions }
) => Promise<Response>

export interface InterceptorCallbacks {
  onShowLogin: () => void
  onShowCaptcha: (config: { type: CaptchaType; captchaUrl?: string }) => Promise<boolean>
  onRequest?: (extend?: AdminFetchExtendOptions) => void
  onResponse?: (extend?: AdminFetchExtendOptions) => void
  onError?: (extend?: AdminFetchExtendOptions) => void
}
