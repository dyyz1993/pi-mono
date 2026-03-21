import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { getCookie } from 'hono/cookie'
import { generateCaptcha, verifyCaptcha } from '../services/captcha-service'
import { markCaptchaVerifiedMiddleware } from '../../middleware/captcha'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import {
  CaptchaResponseSchema,
  VerifyCaptchaRequestSchema,
  CaptchaVerifyResponseSchema,
} from '@shared/modules/captcha'

const getCaptchaRoute = createRoute({
  method: 'get',
  path: '/captcha',
  tags: ['captcha'],
  responses: {
    200: successResponse(CaptchaResponseSchema, 'Get captcha'),
  },
})

const verifyCaptchaRoute = createRoute({
  method: 'post',
  path: '/verify-captcha',
  tags: ['captcha'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: VerifyCaptchaRequestSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(CaptchaVerifyResponseSchema, 'Captcha verified'),
    400: errorResponse('Invalid captcha'),
  },
})

export const captchaRoutes = new OpenAPIHono()
  .openapi(getCaptchaRoute, c => {
    const { id, image } = generateCaptcha()

    return c.json(success({ id, image }), 200)
  })
  .openapi(verifyCaptchaRoute, async c => {
    const { id, code } = c.req.valid('json')

    const isValid = verifyCaptcha(id, code)

    if (isValid) {
      const sessionId = getCookie(c, 'session_id')
      if (sessionId) {
        markCaptchaVerifiedMiddleware(sessionId)
      }

      return c.json(success({ message: '验证成功' }), 200)
    } else {
      return c.json(
        {
          success: false,
          error: '验证码错误或已过期',
        },
        400
      )
    }
  })
