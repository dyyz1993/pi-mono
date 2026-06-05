export interface FileTimeGuardConfig {
	enabled: boolean;
	checkMode: "block" | "warn" | "ignore";
	ignorePatterns: string[];
	sessionTimeout: number;
}

export const DEFAULT_CONFIG: FileTimeGuardConfig = {
	enabled: true,
	checkMode: "block",
	ignorePatterns: ["node_modules/**", ".git/**", "dist/**", "build/**"],
	sessionTimeout: 30 * 60 * 1000,
};
