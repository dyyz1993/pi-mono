import type { Model } from "@dyyz1993/pi-ai";

const TIER_KEYS = ["fast", "pro", "max"] as const;
type TierKey = (typeof TIER_KEYS)[number];

function modelKey(model: Pick<Model<any>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

function scoreFast(model: Model<any>): number {
	const text = `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase();
	let score = 0;
	if (text.includes("flash")) score += 5;
	if (text.includes("mini")) score += 4;
	if (text.includes("fast")) score += 4;
	if (text.includes("lite")) score += 3;
	if (text.includes("air")) score += 2;
	if (model.reasoning) score -= 1;
	return score;
}

function scoreMax(model: Model<any>): number {
	const contextWindow = typeof model.contextWindow === "number" ? model.contextWindow : 0;
	const maxTokens = typeof model.maxTokens === "number" ? model.maxTokens : 0;
	return (model.reasoning ? 10_000_000 : 0) + contextWindow + maxTokens;
}

function pickByScore(models: Model<any>[], score: (model: Model<any>) => number): Model<any> | undefined {
	let best: Model<any> | undefined;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const model of models) {
		const nextScore = score(model);
		if (!best || nextScore > bestScore) {
			best = model;
			bestScore = nextScore;
		}
	}
	return best;
}

export function normalizeTierModelsForAvailableModels(
	tierModels: Record<string, string>,
	availableModels: Model<any>[],
	currentModel?: Model<any>,
): Record<string, string> {
	if (availableModels.length === 0) return { ...tierModels };

	const availableKeys = new Set(availableModels.map(modelKey));
	const existing = { ...tierModels };
	const fast = pickByScore(availableModels, scoreFast) ?? availableModels[0];
	const max = pickByScore(availableModels, scoreMax) ?? availableModels[availableModels.length - 1] ?? fast;
	const current = currentModel && availableKeys.has(modelKey(currentModel)) ? currentModel : undefined;
	const pro =
		current ??
		availableModels.find((model) => model !== fast && model !== max) ??
		availableModels.find((model) => model !== fast) ??
		fast;

	const fallback: Record<TierKey, string> = {
		fast: modelKey(fast),
		pro: modelKey(pro),
		max: modelKey(max),
	};

	for (const tier of TIER_KEYS) {
		if (!existing[tier] || !availableKeys.has(existing[tier])) {
			existing[tier] = fallback[tier];
		}
	}

	return existing;
}
