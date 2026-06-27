import { randomUUID } from "node:crypto";
import { minimatch } from "minimatch";
import { asRecord } from "../../utils/type-helpers.ts";
import { matchPathGlob } from "./path-patterns.ts";

export type PermissionRuleAction = "allow" | "deny";
export type PermissionRuleScope = "project" | "session";

export interface PermissionRule {
	id: string;
	provider: string;
	subject: string;
	pattern: string;
	action: PermissionRuleAction;
	scope: PermissionRuleScope;
	createdAt: string;
	metadata?: Record<string, unknown>;
}

export interface PermissionSettings {
	rules?: PermissionRule[];
}

export interface PermissionRuleInput {
	provider: string;
	subject: string;
	pattern: string;
	action: PermissionRuleAction;
	scope?: PermissionRuleScope;
	id?: string;
	createdAt?: string;
	metadata?: Record<string, unknown>;
}

export interface PermissionRuleMatchInput {
	provider: string;
	subject: string;
	value: string;
	scope?: PermissionRuleScope;
}

export interface PermissionRuleDecision {
	action: PermissionRuleAction;
	rule: PermissionRule;
}

export interface PermissionStoreSettingsHost {
	getProjectSettings(): { permissions?: unknown };
	isProjectTrusted?(): boolean;
	applyOverrides(overrides: { permissions?: PermissionSettings }, scope: "project"): void;
	flush(): Promise<void>;
}

const sessionRulesBySettings = new WeakMap<PermissionStoreSettingsHost, PermissionRule[]>();

export class PermissionStore {
	private readonly settings: PermissionStoreSettingsHost;

	constructor(settings: PermissionStoreSettingsHost) {
		this.settings = settings;
	}

	getRules(): PermissionRule[] {
		return [...this.getProjectRules(), ...this.getSessionRules()];
	}

	async addRule(input: PermissionRuleInput): Promise<PermissionRule> {
		const rule: PermissionRule = {
			id: input.id ?? `perm_${randomUUID()}`,
			provider: input.provider,
			subject: input.subject,
			pattern: input.pattern,
			action: input.action,
			scope: input.scope ?? "project",
			createdAt: input.createdAt ?? new Date().toISOString(),
			metadata: input.metadata,
		};
		if (rule.scope === "session" || this.settings.isProjectTrusted?.() === false) {
			const sessionRule = { ...rule, scope: "session" as const };
			const nextRules = this.getSessionRules().filter((existing) => !isSameRuleTarget(existing, sessionRule));
			nextRules.push(sessionRule);
			sessionRulesBySettings.set(this.settings, nextRules);
			return sessionRule;
		}

		const nextRules = this.getProjectRules().filter((existing) => !isSameRuleTarget(existing, rule));
		nextRules.push(rule);
		await this.writeRules(nextRules);
		return rule;
	}

	async removeRule(ruleId: string): Promise<void> {
		const nextSessionRules = this.getSessionRules().filter((rule) => rule.id !== ruleId);
		sessionRulesBySettings.set(this.settings, nextSessionRules);
		await this.writeRules(this.getProjectRules().filter((rule) => rule.id !== ruleId));
	}

	findDecision(input: PermissionRuleMatchInput): PermissionRuleDecision | undefined {
		const scope = input.scope ?? "project";
		const matches = this.getRules()
			.filter((rule) => rule.provider === input.provider && rule.subject === input.subject && rule.scope === scope)
			.map((rule) => ({ rule, specificity: getRuleSpecificity(rule, input.value) }))
			.filter((match) => match.specificity >= 0)
			.sort((a, b) => {
				if (b.specificity !== a.specificity) return b.specificity - a.specificity;
				if (a.rule.action !== b.rule.action) return a.rule.action === "deny" ? -1 : 1;
				return a.rule.createdAt.localeCompare(b.rule.createdAt);
			});

		const match = matches[0];
		if (!match) return undefined;
		return { action: match.rule.action, rule: match.rule };
	}

	private async writeRules(rules: PermissionRule[]): Promise<void> {
		this.settings.applyOverrides({ permissions: { rules } }, "project");
		await this.settings.flush();
	}

	private getProjectRules(): PermissionRule[] {
		return readPermissionRules(this.settings.getProjectSettings().permissions);
	}

	private getSessionRules(): PermissionRule[] {
		return sessionRulesBySettings.get(this.settings) ?? [];
	}
}

function isSameRuleTarget(a: PermissionRule, b: PermissionRule): boolean {
	return a.provider === b.provider && a.subject === b.subject && a.pattern === b.pattern && a.scope === b.scope;
}

export function readPermissionRules(value: unknown): PermissionRule[] {
	const permissions = asRecord(value);
	if (!Array.isArray(permissions.rules)) return [];
	return permissions.rules
		.filter(isPermissionRule)
		.map((rule) => ({ ...rule, metadata: cloneMetadata(rule.metadata) }));
}

function isPermissionRule(value: unknown): value is PermissionRule {
	const rule = asRecord(value);
	return (
		typeof rule.id === "string" &&
		typeof rule.provider === "string" &&
		typeof rule.subject === "string" &&
		typeof rule.pattern === "string" &&
		(rule.action === "allow" || rule.action === "deny") &&
		(rule.scope === "project" || rule.scope === "session") &&
		typeof rule.createdAt === "string"
	);
}

function cloneMetadata(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	return { ...asRecord(value) };
}

function getRuleSpecificity(rule: PermissionRule, value: string): number {
	if (rule.pattern === value) return Number.MAX_SAFE_INTEGER;
	if (isFileSubject(rule.subject)) {
		return matchPathGlob(value, rule.pattern) ? globSpecificity(rule.pattern) : -1;
	}
	return matchValueGlob(value, rule.pattern) ? globSpecificity(rule.pattern) : -1;
}

function isFileSubject(subject: string): boolean {
	return subject === "file.read" || subject === "file.write" || subject.startsWith("file.");
}

function matchValueGlob(value: string, pattern: string): boolean {
	try {
		return minimatch(value, pattern, { dot: true });
	} catch {
		return false;
	}
}

function globSpecificity(pattern: string): number {
	let score = 0;
	for (const char of pattern) {
		if (char !== "*" && char !== "?") score++;
	}
	return score;
}
