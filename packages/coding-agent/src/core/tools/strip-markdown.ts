export function stripMarkdownCodeBlock(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^```(?:\w*\n)?([\s\S]*?)```$/);
	if (match) return match[1]!.trim();
	return trimmed;
}
