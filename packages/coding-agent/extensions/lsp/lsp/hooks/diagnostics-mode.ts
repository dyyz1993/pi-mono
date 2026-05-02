export type DiagnosticsModeName = "agent_end" | "edit_write" | "disabled";

const VALID_MODES: DiagnosticsModeName[] = ["agent_end", "edit_write", "disabled"];

export interface DiagnosticsMode {
	get(): DiagnosticsModeName;
	set(mode: DiagnosticsModeName): void;
	addTouchedFile(filePath: string): void;
	getTouchedFiles(): string[];
	clearTouchedFiles(): void;
}

export function createDiagnosticsMode(initial?: DiagnosticsModeName): DiagnosticsMode {
	let current: DiagnosticsModeName = VALID_MODES.includes(initial!) ? initial! : "agent_end";
	const touchedFiles: string[] = [];
	const touchedSet = new Set<string>();

	return {
		get(): DiagnosticsModeName {
			return current;
		},
		set(mode: DiagnosticsModeName): void {
			if (VALID_MODES.includes(mode)) {
				current = mode;
			}
		},
		addTouchedFile(filePath: string): void {
			if (!touchedSet.has(filePath)) {
				touchedSet.add(filePath);
				touchedFiles.push(filePath);
			}
		},
		getTouchedFiles(): string[] {
			return [...touchedFiles];
		},
		clearTouchedFiles(): void {
			touchedFiles.length = 0;
			touchedSet.clear();
		},
	};
}
