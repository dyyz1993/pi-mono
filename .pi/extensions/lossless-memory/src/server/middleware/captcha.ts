import type { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

export interface CaptchaConfig {
  skipPaths?: string[]
  maxRequests?: number
  windowMs?: number
}

interface CaptchaSession {
  verified: boolean
  verifiedAt?: number
  requestCount: number
  windowStart: number
}

const captchaSessions = new Map<string, CaptchaSession>()

export function captchaMiddleware(config: CaptchaConfig = {}) {
  const {
    skipPaths = ['/api/captcha', '/api/verify-captcha', '/admin/login', '/admin/register'],
    maxRequests = 10,
    windowMs = 60000,
  } = config

  return async (c: Context, next: Next) => {
    const path = c.req.path

    if (skipPaths.some(skipPath => path.startsWith(skipPath))) {
      return next()
    }

    const sessionId = getCookie(c, 'session_id') || generateSessionId()

    if (!getCookie(c, 'session_id')) {
      setCookie(c, 'session_id', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 86400,
      })
    }

    const session = captchaSessions.get(sessionId) || {
      verified: false,
      requestCount: 0,
      windowStart: Date.now(),
    }

    const now = Date.now()
    if (now - session.windowStart > windowMs) {
      session.requestCount = 0
      session.windowStart = now
    }

    session.requestCount++
    captchaSessions.set(sessionId, session)

    if (session.verified && session.verifiedAt && now - session.verifiedAt < 300000) {
      return next()
    }

    if (session.requestCount > maxRequests) {
      return c.json(
        {
          success: false,
          error: '请求过于频繁，请完成验证码验证',
          needCaptcha: true,
        },
        429
      )
    }

    if (isSuspiciousRequest(c)) {
      return c.json(
        {
          success: false,
          error: '检测到可疑行为，请完成验证码验证',
          needCaptcha: true,
        },
        403
      )
    }

    return next()
  }
}

export function verifyCaptchaMiddleware() {
  return async (c: Context, next: Next) => {
    const sessionId = getCookie(c, 'session_id')

    if (!sessionId) {
      return c.json({ success: false, error: 'Session not found' }, 400)
    }

    const session = captchaSessions.get(sessionId)

    if (session) {
      session.verified = true
      session.verifiedAt = Date.now()
      captchaSessions.set(sessionId, session)
    }

    return next()
  }
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

function isSuspiciousRequest(c: Context): boolean {
  const userAgent = c.req.header('User-Agent') || ''

  if (!userAgent || userAgent.length < 10) {
    return true
  }

  if (userAgent.includes('bot') || userAgent.includes('crawler')) {
    return true
  }

  return false
}

export function markCaptchaVerifiedMiddleware(sessionId: string) {
  const session = captchaSessions.get(sessionId)
  if (session) {
    session.verified = true
    session.verifiedAt = Date.now()
    session.requestCount = 0
    session.windowStart = Date.now()
    captchaSessions.set(sessionId, session)
  }
}

export function clearCaptchaSessionMiddleware(sessionId: string) {
  captchaSessions.delete(sessionId)
}
