import { createRPCClient } from '../rpc/client'

const DEFAULT_BASE_URL = 'http://localhost:3000'

let globalBaseUrl = process.env.BIOMIMIC_API_URL || DEFAULT_BASE_URL

export function setBaseUrl(url: string) {
  globalBaseUrl = url
}

export function getBaseUrl(): string {
  return globalBaseUrl
}

export function getClient() {
  return createRPCClient(globalBaseUrl)
}
