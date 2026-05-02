export interface FileTrackerOptions {
	maxOpenFiles?: number;
	now?: () => number;
}

export interface FileTracker {
	open(filePath: string, onClose: (file: string) => void): void;
	getOpenFiles(): string[];
	getIdleFiles(idleMs: number): string[];
	closeAll(onClose: (file: string) => void): void;
}

interface TrackedFile {
	filePath: string;
	lastAccess: number;
}

export function createFileTracker(options: FileTrackerOptions = {}): FileTracker {
	const maxOpenFiles = options.maxOpenFiles ?? 30;
	const now = options.now ?? (() => Date.now());
	const files = new Map<string, TrackedFile>();
	const order: string[] = [];

	return {
		open(filePath: string, onClose: (file: string) => void): void {
			if (files.has(filePath)) {
				const entry = files.get(filePath)!;
				entry.lastAccess = now();
				const idx = order.indexOf(filePath);
				if (idx !== -1) {
					order.splice(idx, 1);
				}
				order.push(filePath);
				return;
			}

			while (order.length >= maxOpenFiles) {
				const evicted = order.shift()!;
				files.delete(evicted);
				onClose(evicted);
			}

			files.set(filePath, { filePath, lastAccess: now() });
			order.push(filePath);
		},

		getOpenFiles(): string[] {
			return [...order];
		},

		getIdleFiles(idleMs: number): string[] {
			const threshold = now() - idleMs;
			const idle: string[] = [];
			for (const entry of files.values()) {
				if (entry.lastAccess < threshold) {
					idle.push(entry.filePath);
				}
			}
			return idle;
		},

		closeAll(onClose: (file: string) => void): void {
			for (const filePath of order) {
				onClose(filePath);
			}
			files.clear();
			order.length = 0;
		},
	};
}
