export function matchGlob(pattern: string, target: string): boolean {
	if (!pattern || !target) return false;

	const normalizedTarget = target.replace(/\\/g, "/");
	let i = 0;
	let re = "";

	while (i < pattern.length) {
		const ch = pattern[i];
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				re += ".*";
				i += 2;
				if (pattern[i] === "/") i++;
				continue;
			}
			re += "[^/]*";
		} else if (ch === "?") {
			re += "[^/]";
		} else if (ch === ".") {
			re += "\\.";
		} else if (ch === "{") {
			const close = pattern.indexOf("}", i);
			if (close !== -1) {
				re += `(${pattern.slice(i + 1, close).replace(/,/g, "|")})`;
				i = close;
			} else {
				re += ch;
			}
		} else {
			re += ch;
		}
		i++;
	}

	return new RegExp(`^${re}$`).test(normalizedTarget);
}

export function matchesAnyGlob(globs: string[], filePath: string): boolean {
	if (!filePath || globs.length === 0) return false;
	const normalized = filePath.replace(/\\/g, "/");
	return globs.some((g) => matchGlob(g, normalized));
}
