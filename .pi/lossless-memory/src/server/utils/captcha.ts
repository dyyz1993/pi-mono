const CAPTCHA_EXPIRY = 5 * 60 * 1000
const MAX_ATTEMPTS = 3

interface CaptchaData {
  code: string
  createdAt: number
  attempts: number
}

const captchaStore = new Map<string, CaptchaData>()

export function generateCaptcha(): { id: string; image: string } {
  // Cleanup expired captchas on each generation (since setInterval is not allowed in CF Workers)
  cleanupExpiredCaptchas()

  const id = Math.random().toString(36).substring(2) + Date.now().toString(36)
  const code = Math.random().toString(36).substring(2, 7).toUpperCase()

  captchaStore.set(id, {
    code,
    createdAt: Date.now(),
    attempts: 0,
  })

  const image = generateCaptchaSVG(code)

  return { id, image }
}

export function verifyCaptcha(id: string, code: string): boolean {
  const captchaData = captchaStore.get(id)

  if (!captchaData) {
    return false
  }

  if (Date.now() - captchaData.createdAt > CAPTCHA_EXPIRY) {
    captchaStore.delete(id)
    return false
  }

  if (captchaData.attempts >= MAX_ATTEMPTS) {
    captchaStore.delete(id)
    return false
  }

  captchaData.attempts++

  const isValid = captchaData.code.toUpperCase() === code.toUpperCase()

  if (isValid) {
    captchaStore.delete(id)
  }

  return isValid
}

function generateCaptchaSVG(code: string): string {
  const width = 200
  const height = 60
  const chars = code.split('')

  const charElements = chars
    .map((char, i) => {
      const x = 30 + i * 30
      const y = 35 + Math.random() * 10 - 5
      const rotation = (Math.random() - 0.5) * 40
      const hue = Math.random() * 360

      return `<text 
      x="${x}" 
      y="${y}" 
      font-family="Arial, sans-serif" 
      font-size="40" 
      font-weight="bold"
      fill="hsl(${hue}, 70%, 30%)"
      transform="rotate(${rotation} ${x} ${y})"
    >${char}</text>`
    })
    .join('')

  const noiseElements = Array.from({ length: 50 }, () => {
    const x = Math.random() * width
    const y = Math.random() * height
    const r = Math.random() * 2
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.5)" />`
  }).join('')

  const lineElements = Array.from({ length: 5 }, () => {
    const x1 = Math.random() * width
    const y1 = Math.random() * height
    const x2 = Math.random() * width
    const y2 = Math.random() * height
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.3)" stroke-width="1" />`
  }).join('')

  return `data:image/svg+xml;base64,${Buffer.from(
    `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#f0f0f0" />
      ${noiseElements}
      ${lineElements}
      ${charElements}
    </svg>
  `
  ).toString('base64')}`
}

export function cleanupExpiredCaptchas(): void {
  const now = Date.now()
  for (const [id, data] of captchaStore.entries()) {
    if (now - data.createdAt > CAPTCHA_EXPIRY) {
      captchaStore.delete(id)
    }
  }
}

// Note: setInterval is not allowed in Cloudflare Workers global scope
// Cleanup is triggered on each generateCaptcha call instead
