export type RuleSeverity = "critical" | "high" | "medium" | "low" | "hint";

export type RuleScope = "user" | "pi" | "project" | "managed";

export interface RuleFrontmatter {
	paths?: string[];
	description?: string;
	severity?: RuleSeverity;
	allowedTools?: string[];
	whenToUse?: string;
	version?: string;
	model?: string;
	skills?: string;
	effort?: string;
	userInvocable?: string;
	context?: "inline" | "fork";
	agent?: string;
	shell?: string;
	notifyOnMatch?: boolean;
	skipInPrompt?: boolean;
}

export interface ParsedRule {
	name: string;
	filePath: string;
	title: string;
	content: string;
	scope: RuleScope;
	source: string;
	frontmatter: RuleFrontmatter;
	isUnconditional: boolean;
}

export interface RuleCache {
	rules: ParsedRule[];
	unconditional: ParsedRule[];
	conditional: ParsedRule[];
	loadedAt: number;
}

export interface CachedRules {
	rules: ParsedRule[];
	loadedAt: number;
}

export interface RulesConfig {
	cacheTTL: number;
	notifyOnLoad: boolean;
	notifyOnMatch: boolean;
	dirs?: {
		user?: string[];
		pi?: string[];
		project?: string[];
		managed?: string[];
	};
}

export interface RuleDetail {
	name: string;
	title: string;
	filePath: string;
	scope: RuleScope;
	source: string;
	severity: RuleSeverity;
	isUnconditional: boolean;
	paths: string[];
	description?: string;
}

export interface ScannedDir {
	dir: string;
	fileCount: number;
	ruleNames: string[];
}

export interface MatchedRuleDetail {
	name: string;
	title: string;
	severity: RuleSeverity;
	matchedGlob: string;
}

export interface MatchRecord {
	filePath: string;
	ruleNames: string[];
	toolName: string;
	toolCallId: string;
	severity: "info" | "warning";
	timestamp: number;
	matchedRuleDetails?: MatchedRuleDetail[];
}

export interface LifecycleEntry {
	event: "loaded" | "restored" | "injected" | "reloaded" | "unloaded" | "expired";
	message: string;
	ruleCount?: number;
	timestamp: number;
	details?: {
		scannedDirs?: ScannedDir[];
		configSource?: string;
		cacheHit?: boolean;
		injectedRules?: Array<{ name: string; promptDelta: number }>;
	};
}

export interface SnapshotPayload {
	type: "snapshot";
	rules: RuleDetail[];
	injectedRuleNames: string[];
	totalRules: number;
	unconditionalCount: number;
	conditionalCount: number;
	matchHistory: MatchRecord[];
	lifecycleLog: LifecycleEntry[];
	loadedAt: number;
	cacheTTL: number;
}

export interface MatchedPayload {
	type: "matched";
	filePath: string;
	matchedRules: MatchedRuleDetail[];
	toolName: string;
	toolCallId: string;
	severity: "info" | "warning";
	timestamp: number;
}

export interface InjectedPayload {
	type: "injected";
	ruleNames: string[];
	systemPromptLength: number;
}

export interface ReloadedPayload {
	type: "reloaded";
	rules: RuleDetail[];
	loadedAt: number;
}

export interface UnloadedPayload {
	type: "unloaded";
	reason: string;
}

export type RulesChannelEvent = SnapshotPayload | MatchedPayload | InjectedPayload | ReloadedPayload | UnloadedPayload;

export interface RulesChannelContract {
	methods: {
		getSnapshot: {
			params: { cwd?: string };
			return: SnapshotPayload;
		};
	};
	events: {
		snapshot: SnapshotPayload;
		matched: MatchedPayload;
		injected: InjectedPayload;
		reloaded: ReloadedPayload;
		unloaded: UnloadedPayload;
	};
}
