export type PermissionAction = "allow_once" | "always_allow_project" | "deny_once" | "always_deny_project";

export type PermissionDecision =
	| { type: "allow"; reason?: string }
	| { type: "deny"; reason: string }
	| { type: "ask"; request: PermissionRequest }
	| { type: "mutate"; input: Record<string, unknown>; reason?: string }
	| { type: "pass" };

export interface PermissionRememberOption {
	id: string;
	label: string;
	subject: string;
	pattern: string;
	scope: "project" | "session";
	action: "allow" | "deny";
	metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
	requestId: string;
	sessionId: string;
	toolCallId?: string;
	provider: string;
	subject: string;
	title: string;
	message: string;
	actions: PermissionAction[];
	rememberOptions?: PermissionRememberOption[];
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface PermissionContext {
	sessionId: string;
	cwd: string;
	permissionProfile: string;
	toolName: string;
	toolCallId?: string;
	input: Record<string, unknown>;
	agent?: {
		name?: string;
		tools?: string[];
		disallowedTools?: string[];
		paths?: {
			read?: string[];
			write?: string[];
			bash?: string[];
		};
	};
}
