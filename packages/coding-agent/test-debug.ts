import { normalizeForFuzzyMatch } from './src/core/tools/edit-diff.js';

const content = 'let x = "hello";\nlet y = "hello";';
const oldText = 'let x = "hello"';

console.log('Original content:', content);
console.log('Old text:', oldText);
console.log('---');
console.log('Normalized content:', normalizeForFuzzyMatch(content));
console.log('Normalized oldText:', normalizeForFuzzyMatch(oldText));
console.log('---');

const normalizedContent = normalizeForFuzzyMatch(content);
const normalizedPattern = normalizeForFuzzyMatch(oldText);

let searchPos = 0;
let count = 0;
while (searchPos < normalizedContent.length) {
	const idx = normalizedContent.indexOf(normalizedPattern, searchPos);
	if (idx === -1) break;
	console.log(`Match ${++count} at index ${idx}: "${normalizedContent.substring(idx, idx + normalizedPattern.length)}"`);
	searchPos = idx + normalizedPattern.length;
}

console.log('Total matches:', count);
