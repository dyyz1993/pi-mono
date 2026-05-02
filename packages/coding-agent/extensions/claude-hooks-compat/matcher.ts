export function matchesMatcher(matcher: string | undefined, toolName: string): boolean {
	if (!matcher || matcher === "" || matcher === "*") return true;

	if (/^[a-zA-Z0-9_|]+$/.test(matcher)) {
		return matcher.split("|").includes(toolName);
	}

	try {
		return new RegExp(matcher).test(toolName);
	} catch {
		return false;
	}
}
