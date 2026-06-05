export function matchesMatcher(matcher: string | undefined, toolName: string): boolean {
	if (!matcher || matcher === "" || matcher === "*") return true;

	if (/^[a-zA-Z0-9_|]+$/.test(matcher)) {
		return matcher
			.split("|")
			.map((s) => s.trim().toLowerCase())
			.includes(toolName.toLowerCase());
	}

	try {
		return new RegExp(matcher).test(toolName);
	} catch (err) {
		console.debug("[claude-hooks-compat] matcher regex failed:", err instanceof Error ? err.message : err);
		return false;
	}
}
