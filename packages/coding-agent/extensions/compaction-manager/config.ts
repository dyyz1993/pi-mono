export interface CompactionManagerConfig {
	microcompact: {
		enabled: boolean;
		maxAgeMs: number;
		clearableTools: string[];
	};
	sessionMemory: {
		enabled: boolean;
		memoryDir: string;
		minContentLength: number;
	};
	reactive: {
		enabled: boolean;
		warnPercent: number;
		forceCompactPercent: number;
	};
}

export const DEFAULT_CONFIG: CompactionManagerConfig = {
	microcompact: {
		enabled: true,
		maxAgeMs: 60 * 60 * 1000,
		clearableTools: ["read", "bash", "grep", "find", "glob", "webFetch"],
	},
	sessionMemory: {
		enabled: true,
		memoryDir: ".pi/memory",
		minContentLength: 50,
	},
	reactive: {
		enabled: true,
		warnPercent: 75,
		forceCompactPercent: 90,
	},
};
