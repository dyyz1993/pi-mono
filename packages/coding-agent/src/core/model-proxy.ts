import type { Api, Model } from "@dyyz1993/pi-ai";

export const MODEL_PROXY_PLACEHOLDER_API_KEY = "pi-model-proxy-placeholder";
export const MODEL_PROXY_HEADER_TOKEN = "x-pi-model-proxy-token";
export const MODEL_PROXY_HEADER_PROVIDER = "x-pi-model-proxy-provider";
export const MODEL_PROXY_HEADER_MODEL = "x-pi-model-proxy-model";
export const MODEL_PROXY_HEADER_API = "x-pi-model-proxy-api";

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function getProxyUrl(): string | undefined {
	const value = process.env.PI_MODEL_PROXY_URL?.trim();
	return value ? value.replace(/\/+$/, "") : undefined;
}

function getProxyToken(): string | undefined {
	const value = process.env.PI_MODEL_PROXY_TOKEN?.trim();
	return value || undefined;
}

export function isModelProxyEnabled(): boolean {
	return !!(getProxyUrl() && getProxyToken());
}

export function loadModelProxyModels(): Model<Api>[] | null {
	const proxyUrl = getProxyUrl();
	const token = getProxyToken();
	const raw = process.env.PI_MODEL_PROXY_MODELS_JSON;
	if (!proxyUrl || !token || !raw) return null;

	try {
		const parsed = JSON.parse(raw) as Model<Api>[];
		if (!Array.isArray(parsed)) return null;
		return parsed
			.filter((model) => model && typeof model === "object" && typeof model.baseUrl === "string")
			.map((model) => rewriteModelForProxy(model, proxyUrl, token));
	} catch {
		return null;
	}
}

export function rewriteModelForProxy(model: Model<Api>, proxyUrl: string, token: string): Model<Api> {
	const encodedBaseUrl = base64UrlEncode(model.baseUrl);
	return {
		...model,
		baseUrl: `${proxyUrl}/proxy/${encodedBaseUrl}`,
		headers: {
			...(model.headers ?? {}),
			[MODEL_PROXY_HEADER_TOKEN]: token,
			[MODEL_PROXY_HEADER_PROVIDER]: model.provider,
			[MODEL_PROXY_HEADER_MODEL]: model.id,
			[MODEL_PROXY_HEADER_API]: model.api,
		},
	};
}
