const COLLAPSED_WHITESPACE = /\s+/g;

export interface CommandPatternSuggestion {
	id: string;
	label: string;
	pattern: string;
	metadata?: Record<string, unknown>;
}

export function normalizeCommandForPermission(command: string): string {
	return command.trim().replace(COLLAPSED_WHITESPACE, " ");
}

export function createDangerousCommandPatternSuggestions(input: {
	command: string;
	patternId: string;
}): CommandPatternSuggestion[] {
	const normalized = normalizeCommandForPermission(input.command);
	const suggestions: CommandPatternSuggestion[] = [
		{
			id: "command-exact",
			label: "Exact command",
			pattern: input.command,
			metadata: { matchKind: "exact" },
		},
	];

	if (normalized !== input.command) {
		suggestions.push({
			id: "command-normalized",
			label: "Same command after whitespace normalization",
			pattern: normalized,
			metadata: { matchKind: "normalized" },
		});
	}

	const family = createCommandFamilySuggestion(normalized, input.patternId);
	if (family && !suggestions.some((suggestion) => suggestion.pattern === family.pattern)) {
		suggestions.push(family);
	}

	return suggestions;
}

function createCommandFamilySuggestion(command: string, patternId: string): CommandPatternSuggestion | undefined {
	if (patternId === "skip-verification") {
		if (/^git\s+commit\b/.test(command)) {
			return {
				id: "command-family-git-commit-no-verify",
				label: "Any git commit that skips verification",
				pattern: "git commit *--no-verify*",
				metadata: { matchKind: "family", family: "git-commit-no-verify" },
			};
		}
		return {
			id: "command-family-no-verify",
			label: "Any command containing --no-verify",
			pattern: "*--no-verify*",
			metadata: { matchKind: "family", family: "no-verify" },
		};
	}

	if (patternId === "git-push-force" && /^git\s+push\b/.test(command)) {
		return {
			id: "command-family-git-push-force",
			label: "Any git push that forces updates",
			pattern: "git push *--force*",
			metadata: { matchKind: "family", family: "git-push-force" },
		};
	}

	return undefined;
}
