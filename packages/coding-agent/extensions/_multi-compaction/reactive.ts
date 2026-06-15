export function shouldWarn(tokens: number | null, contextWindow: number, warnPercent: number): boolean {
	if (tokens === null) return false;
	return (tokens / contextWindow) * 100 >= warnPercent;
}

export function shouldForceCompact(tokens: number | null, contextWindow: number, forcePercent: number): boolean {
	if (tokens === null) return false;
	return (tokens / contextWindow) * 100 >= forcePercent;
}
