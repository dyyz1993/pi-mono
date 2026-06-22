import type { PermissionProvider, PermissionProviderFailure } from "./provider.ts";
import type { PermissionContext, PermissionDecision } from "./types.ts";

export interface PermissionRuntimeOptions {
	providers?: PermissionProvider[];
	onProviderFailure?: (failure: PermissionProviderFailure) => void;
	defaultDecision?: PermissionDecision;
}

export class PermissionRuntime {
	private providers: PermissionProvider[];
	private onProviderFailure?: (failure: PermissionProviderFailure) => void;
	private defaultDecision: PermissionDecision;

	constructor(options: PermissionRuntimeOptions = {}) {
		this.providers = sortProviders(options.providers ?? []);
		this.onProviderFailure = options.onProviderFailure;
		this.defaultDecision = options.defaultDecision ?? { type: "allow" };
	}

	getProviders(): readonly PermissionProvider[] {
		return this.providers;
	}

	setProviders(providers: PermissionProvider[]): void {
		this.providers = sortProviders(providers);
	}

	registerProvider(provider: PermissionProvider): void {
		this.providers = sortProviders([...this.providers, provider]);
	}

	async evaluate(ctx: PermissionContext): Promise<PermissionDecision> {
		for (const provider of this.providers) {
			try {
				if (provider.applies) {
					const applies = await provider.applies(ctx);
					if (!applies) continue;
				}

				const decision = await provider.check(ctx);
				if (decision.type === "pass") continue;
				return decision;
			} catch (error) {
				this.onProviderFailure?.({ providerName: provider.name, error, context: ctx });
				return {
					type: "deny",
					reason: `Permission provider "${provider.name}" failed: ${formatProviderError(error)}`,
				};
			}
		}

		return this.defaultDecision;
	}
}

function sortProviders(providers: PermissionProvider[]): PermissionProvider[] {
	return [...providers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

function formatProviderError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
