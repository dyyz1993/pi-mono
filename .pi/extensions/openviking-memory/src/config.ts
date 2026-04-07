/**
 * OpenViking Memory Extension - Configuration & HTTP Client
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenVikingConfig, OpenVikingResponse } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONFIG: OpenVikingConfig = {
	endpoint: "http://localhost:1933",
	apiKey: "",
	enabled: true,
	timeoutMs: 30000,
	autoCommit: {
		enabled: true,
		intervalMinutes: 10,
	},
};

// ============================================================================
// Configuration
// ============================================================================

export function getAutoCommitIntervalMinutes(config: OpenVikingConfig): number {
	const configured = Number(config.autoCommit?.intervalMinutes ?? 10);
	if (!Number.isFinite(configured)) return 10;
	return Math.max(1, configured);
}

export function loadConfig(): OpenVikingConfig {
	const configPath = path.join(__dirname, "openviking-config.json");

	try {
		if (fs.existsSync(configPath)) {
			const fileContent = fs.readFileSync(configPath, "utf-8");
			const fileConfig = JSON.parse(fileContent);
			const autoCommit = fileConfig.autoCommit
				? { ...DEFAULT_CONFIG.autoCommit, ...fileConfig.autoCommit }
				: { ...DEFAULT_CONFIG.autoCommit };

			const config: OpenVikingConfig = {
				...DEFAULT_CONFIG,
				...fileConfig,
				autoCommit,
			};
			if (config.autoCommit) {
				config.autoCommit.intervalMinutes = getAutoCommitIntervalMinutes(config);
			}
			if (process.env.OPENVIKING_API_KEY) {
				config.apiKey = process.env.OPENVIKING_API_KEY;
			}
			return config;
		}
	} catch (error) {
		console.warn(`Failed to load OpenViking config from ${configPath}:`, error);
	}

	const config: OpenVikingConfig = {
		...DEFAULT_CONFIG,
		autoCommit: { ...DEFAULT_CONFIG.autoCommit },
	};

	if (process.env.OPENVIKING_API_KEY) config.apiKey = process.env.OPENVIKING_API_KEY;
	if (config.autoCommit) config.autoCommit.intervalMinutes = getAutoCommitIntervalMinutes(config);

	return config;
}

// ============================================================================
// HTTP Client
// ============================================================================

interface HttpRequestOptions {
	method: "GET" | "POST" | "PUT" | "DELETE";
	endpoint: string;
	body?: any;
	timeoutMs?: number;
	abortSignal?: AbortSignal;
}

export async function makeRequest<T = any>(config: OpenVikingConfig, options: HttpRequestOptions): Promise<T> {
	const url = `${config.endpoint}${options.endpoint}`;
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (config.apiKey) headers["X-API-Key"] = config.apiKey;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.timeoutMs);
	const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;

	try {
		const response = await fetch(url, {
			method: options.method,
			headers,
			body: options.body ? JSON.stringify(options.body) : undefined,
			signal,
		});
		clearTimeout(timeout);

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage: string;
			try {
				const errorJson = JSON.parse(errorText);
				const rawError = errorJson.error || errorJson.message;
				errorMessage =
					typeof rawError === "string"
						? rawError
						: rawError && typeof rawError === "object"
							? JSON.stringify(rawError)
							: errorText;
			} catch {
				errorMessage = errorText;
			}

			switch (response.status) {
				case 401:
				case 403:
					throw new Error("Authentication failed. Please check API key configuration.");
				case 404:
					throw new Error(`Resource not found: ${options.endpoint}`);
				case 500:
					throw new Error(`OpenViking server error: ${errorMessage}`);
				default:
					throw new Error(`Request failed (${response.status}): ${errorMessage}`);
			}
		}
		return (await response.json()) as T;
	} catch (error: unknown) {
		clearTimeout(timeout);
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Request timeout after ${options.timeoutMs ?? config.timeoutMs}ms`);
		}
		const err = error as Error;
		if (err.message?.includes("fetch failed") || (err as any).code === "ECONNREFUSED") {
			throw new Error(
				`OpenViking service unavailable at ${config.endpoint}. Please check if the service is running.`,
			);
		}
		throw error;
	}
}

export function getResponseErrorMessage(error: OpenVikingResponse["error"]): string {
	if (!error) return "Unknown OpenViking error";
	if (typeof error === "string") return error;
	return error.message || (error as any).code || "Unknown OpenViking error";
}

export function unwrapResponse<T>(response: OpenVikingResponse<T>): T {
	if (!response || typeof response !== "object") throw new Error("OpenViking returned an invalid response");
	if (response.status && response.status !== "ok") throw new Error(getResponseErrorMessage(response.error));
	return response.result as T;
}

export async function checkServiceHealth(config: OpenVikingConfig): Promise<boolean> {
	try {
		const response = await fetch(`${config.endpoint}/health`, { method: "GET", signal: AbortSignal.timeout(3000) });
		return response.ok;
	} catch {
		return false;
	}
}

// ============================================================================
// Utility Functions
// ============================================================================

type MemoryCounts = number | Record<string, number>;

export function totalMemoriesExtracted(memories?: MemoryCounts): number {
	if (typeof memories === "number") return memories;
	if (!memories || typeof memories !== "object") return 0;
	return Object.entries(memories).reduce(
		(sum, [key, value]) => (key === "total" ? sum : sum + (typeof value === "number" ? value : 0)),
		0,
	);
}

export function totalMemoriesFromResult(result?: { memories_extracted?: MemoryCounts } | null): number {
	return totalMemoriesExtracted(result?.memories_extracted);
}
