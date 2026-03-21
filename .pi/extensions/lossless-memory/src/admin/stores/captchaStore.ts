import { create } from 'zustand'
import type { CaptchaType } from '../services/types'

interface CaptchaState {
  isOpen: boolean
  type: CaptchaType
  captchaUrl: string
  resolveCaptcha: ((success: boolean) => void) | null

  show: (options: { type?: CaptchaType; captchaUrl?: string }) => Promise<boolean>
  resolve: (success: boolean) => void
  close: () => void
}

export const useCaptchaStore = create<CaptchaState>((set, get) => ({
  isOpen: false,
  type: 'image',
  captchaUrl: '/api/captcha',
  resolveCaptcha: null,

  show: options => {
    return new Promise(resolve => {
      set({
        isOpen: true,
        type: options.type || 'image',
        captchaUrl: options.captchaUrl || '/api/captcha',
        resolveCaptcha: resolve,
      })
    })
  },

  resolve: success => {
    const { resolveCaptcha } = get()
    if (resolveCaptcha) {
      resolveCaptcha(success)
    }
    set({ isOpen: false, resolveCaptcha: null })
  },

  close: () => {
    const { resolveCaptcha } = get()
    if (resolveCaptcha) {
      resolveCaptcha(false)
    }
    set({ isOpen: false, resolveCaptcha: null })
  },
}))
