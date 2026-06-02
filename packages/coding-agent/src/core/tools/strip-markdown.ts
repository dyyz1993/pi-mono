export function stripMarkdownCodeBlock(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^```(?:\w*\n)?([\s\S]*?)```$/);
	if (match?.[1]) return match[1].trim();
	return trimmed;
}
