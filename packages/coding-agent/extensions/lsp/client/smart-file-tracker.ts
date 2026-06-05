import { extname } from "node:path";

export interface SmartFileTrackerOptions {
	maxOpenFiles?: number;
	now?: () => number;
	priorityMap?: Record<string, number>;
	excludedExtensions?: Set<string>;
}

export interface MemoryUsage {
	heapUsed: number;
	heapTotal: number;
}

export interface TrackerStatistics {
	totalOpens: number;
	totalEvictions: number;
	evictionReasons: Array<"window_full" | "memory_pressure" | "excluded_type">;
	accessCounts: Map<string, number>;
	openFileCount: number;
}

interface TrackedFile {
	filePath: string;
	lastAccess: number;
	modifiedTime: number;
	accessCount: number;
	priority: number;
}

// Default priority map for common file types (higher = more important)
const DEFAULT_PRIORITY_MAP: Record<string, number> = {
	// TypeScript/JavaScript (highest)
	".ts": 100,
	".tsx": 100,
	".js": 90,
	".jsx": 90,
	".mjs": 90,
	".cjs": 90,

	// Framework files
	".vue": 95,
	".svelte": 95,

	// Other languages
	".py": 80,
	".rs": 80,
	".go": 80,
	".java": 75,
	".kt": 75,
	".c": 70,
	".cpp": 70,
	".h": 70,
	".hpp": 70,
	".cs": 70,

	// Config files
	".json": 30,
	".yaml": 30,
	".yml": 30,
	".toml": 30,

	// Documentation
	".md": 20,

	// Text files
	".txt": 10,
};

	// Default excluded file types (never tracked)
const DEFAULT_EXCLUDED_EXTENSIONS: Set<string> = new Set([
	".log",
	".bak",
	".tmp",
	".temp",
	".swp",
	".cache",
	".DS_Store",
	".map",
	".lock",
	".pid",
	// Special files without extension
	".gitignore",
	".gitattributes",
	".gitmodules",
	".editorconfig",
	".eslintrc",
	".prettierrc",
]);

// Memory thresholds (in bytes)
const HIGH_MEMORY_THRESHOLD = 3_000_000_000; // 3GB
const CRITICAL_MEMORY_THRESHOLD = 3_500_000_000; // 3.5GB
const BASE_MAX_FILES = 30;
const HIGH_MEMORY_MAX_FILES = 10;
const CRITICAL_MEMORY_MAX_FILES = 5;

export interface SmartFileTracker {
	open(filePath: string, onClose: (file: string) => void, mtime?: number): void;
	getOpenFiles(): string[];
	closeAll(onClose: (file: string) => void): void;
	updateMemoryUsage(usage: MemoryUsage): void;
	getStatistics(): TrackerStatistics;
}

export function createSmartFileTracker(options: SmartFileTrackerOptions = {}): SmartFileTracker {
	const baseMaxOpenFiles = options.maxOpenFiles ?? BASE_MAX_FILES;
	const now = options.now ?? (() => Date.now());
	const priorityMap = options.priorityMap ?? DEFAULT_PRIORITY_MAP;
	const excludedExtensions = options.excludedExtensions ?? DEFAULT_EXCLUDED_EXTENSIONS;

	const files = new Map<string, TrackedFile>();
	const stats: TrackerStatistics = {
		totalOpens: 0,
		totalEvictions: 0,
		evictionReasons: [],
		accessCounts: new Map(),
		openFileCount: 0,
	};

	let memoryUsage: MemoryUsage = {
		heapUsed: 0,
		heapTotal: 0,
	};

	// Calculate current max files based on memory pressure
	function getCurrentMaxFiles(): number {
		if (!memoryUsage.heapUsed || !memoryUsage.heapTotal) {
			return baseMaxOpenFiles;
		}

		const memoryRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;

		if (memoryRatio > CRITICAL_MEMORY_THRESHOLD / memoryUsage.heapTotal) {
			return Math.min(CRITICAL_MEMORY_MAX_FILES, baseMaxOpenFiles);
		}

		if (memoryRatio > HIGH_MEMORY_THRESHOLD / memoryUsage.heapTotal) {
			return Math.min(HIGH_MEMORY_MAX_FILES, baseMaxOpenFiles);
		}

		return baseMaxOpenFiles;
	}

	// Get file priority based on extension
	function getFilePriority(filePath: string): number {
		const ext = extname(filePath).toLowerCase();
		return priorityMap[ext] ?? 50; // Default priority for unknown types
	}

	// Check if file should be excluded
	function isExcluded(filePath: string): boolean {
		const ext = extname(filePath).toLowerCase();
		if (excludedExtensions.has(ext)) {
			return true;
		}

		// Check excluded file names (files without extension like .gitignore)
		const basename = filePath.split("/").pop() ?? filePath;
		if (excludedExtensions.has(basename)) {
			return true;
		}

		return false;
	}

	// Sort files by priority (higher first), then by modified time (newer first), then by last access
	function getSortedFiles(): TrackedFile[] {
		return Array.from(files.values()).sort((a, b) => {
			// Higher priority first
			if (b.priority !== a.priority) {
				return b.priority - a.priority;
			}
			// Newer modified time first
			if (b.modifiedTime !== a.modifiedTime) {
				return b.modifiedTime - a.modifiedTime;
			}
			// More recently accessed first
			if (b.lastAccess !== a.lastAccess) {
				return b.lastAccess - a.lastAccess;
			}
			// Higher access count first
			return b.accessCount - a.accessCount;
		});
	}

	// Evict lowest priority file(s) to fit new file
	function evictIfNeeded(onClose: (file: string) => void): void {
		const currentMax = getCurrentMaxFiles();
		// Evict if we're at or over the limit (before adding new file)
		while (files.size >= currentMax) {
			const sorted = getSortedFiles();
			const lowest = sorted[sorted.length - 1]; // Last element has lowest priority

			if (!lowest) {
				break;
			}

			files.delete(lowest.filePath);
			onClose(lowest.filePath);

			stats.totalEvictions++;
			stats.evictionReasons.push("window_full");
			stats.openFileCount = files.size;

			// If memory is high, evict multiple files
			const memoryRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;
			if (memoryRatio > HIGH_MEMORY_THRESHOLD / memoryUsage.heapTotal && files.size > currentMax / 2) {
				continue; // Keep evicting
			}

			break;
		}
	}

	// Evict files to fit within memory constraints
	function evictForMemory(onClose?: (file: string) => void): void {
		const currentMax = getCurrentMaxFiles();
		while (files.size > currentMax) {
			const sorted = getSortedFiles();
			const lowest = sorted[sorted.length - 1];

			if (!lowest) {
				break;
			}

			files.delete(lowest.filePath);
			if (onClose) {
				onClose(lowest.filePath);
			}

			stats.totalEvictions++;
			stats.evictionReasons.push("memory_pressure");
			stats.openFileCount = files.size;
		}
	}

	return {
		open(filePath: string, onClose: (file: string) => void, mtime?: number): void {
			// Check if file is excluded
			if (isExcluded(filePath)) {
				onClose(filePath);
				stats.totalEvictions++;
				stats.evictionReasons.push("excluded_type");
				return;
			}

			stats.totalOpens++;

			// Update access count
			const currentCount = stats.accessCounts.get(filePath) ?? 0;
			stats.accessCounts.set(filePath, currentCount + 1);

			// If file already exists, update its metadata
			if (files.has(filePath)) {
				const entry = files.get(filePath)!;
				entry.lastAccess = now();
				entry.modifiedTime = mtime ?? entry.modifiedTime;
				entry.accessCount++;
				return;
			}

			// Evict files if needed (before adding new file)
			evictIfNeeded(onClose);

			// Add new file
			const newFile: TrackedFile = {
				filePath,
				lastAccess: now(),
				modifiedTime: mtime ?? now(),
				accessCount: 1,
				priority: getFilePriority(filePath),
			};

			files.set(filePath, newFile);
			stats.openFileCount = files.size;
		},

		getOpenFiles(): string[] {
			const sorted = getSortedFiles();
			return sorted.map((f) => f.filePath);
		},

		closeAll(onClose: (file: string) => void): void {
			for (const filePath of files.keys()) {
				onClose(filePath);
			}
			files.clear();
			stats.openFileCount = 0;
		},

		updateMemoryUsage(usage: MemoryUsage): void {
			memoryUsage = usage;
			// Evict files if memory pressure increased window size
			evictForMemory();
		},

		getStatistics(): TrackerStatistics {
			return { ...stats, accessCounts: new Map(stats.accessCounts) };
		},
	};
}