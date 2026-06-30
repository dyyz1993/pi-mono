import * as crypto from "node:crypto";
import type {
	AskUserQuestionResponse,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import type { Theme } from "../interactive/theme/theme.ts";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "./rpc-types.ts";

export const DEFAULT_EXTENSION_UI_TIMEOUT_MS = 60_000;

export type RpcPendingExtensionRequests = Map<
	string,
	{ request: RpcExtensionUIRequest; resolve: (value: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
>;

function normalizeDialogTimeout(timeout: unknown): number {
	if (typeof timeout !== "number") return DEFAULT_EXTENSION_UI_TIMEOUT_MS;
	if (!Number.isFinite(timeout) || timeout <= 0) return DEFAULT_EXTENSION_UI_TIMEOUT_MS;
	return timeout;
}

export function createRpcExtensionUIContext(options: {
	output: (event: object) => void;
	pendingExtensionRequests: RpcPendingExtensionRequests;
	theme?: Theme;
	defaultTimeoutMs?: number;
}): ExtensionUIContext {
	const defaultTimeoutMs = normalizeDialogTimeout(options.defaultTimeoutMs);

	function resolveTimeout(opts: ExtensionUIDialogOptions | undefined): number {
		return opts?.timeout ? normalizeDialogTimeout(opts.timeout) : defaultTimeoutMs;
	}

	function createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		const timeoutMs = resolveTimeout(opts);
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				cleanup("timeout");
				resolve(defaultValue);
			}, timeoutMs);

			const cleanup = (reason: "responded" | "timeout" | "aborted" = "responded") => {
				clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				options.pendingExtensionRequests.delete(id);
				options.output({ type: "extension_ui_resolved", id, reason });
			};

			const onAbort = () => {
				cleanup("aborted");
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			const uiRequest = {
				type: "extension_ui_request",
				id,
				...request,
				timeout: timeoutMs,
			} as RpcExtensionUIRequest;
			options.pendingExtensionRequests.set(id, {
				request: uiRequest,
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup("responded");
					resolve(parseResponse(response));
				},
				reject,
			});
			options.output(uiRequest);
		});
	}

	const theme = options.theme ?? ({} as Theme);

	return {
		askUserQuestion: (questions, opts) =>
			createDialogPromise<AskUserQuestionResponse | undefined>(
				opts,
				undefined,
				{
					method: "askUserQuestion",
					title: opts?.title ?? "Question",
					questions,
					toolCallId: opts?.toolCallId,
				},
				(response) =>
					"action" in response && response.action === "responded" && "answers" in response
						? {
								action: "responded",
								answers: response.answers,
								annotations: response.annotations,
							}
						: undefined,
			),
		select: (title, selectOptions, opts) =>
			createDialogPromise(
				opts,
				undefined,
				{
					method: "select",
					title,
					options: selectOptions,
					multiple: opts?.multiple,
					toolCallId: opts?.toolCallId,
					permissionMeta: opts?.permissionMeta,
				},
				(response) =>
					"cancelled" in response && response.cancelled
						? undefined
						: "value" in response
							? response.value
							: undefined,
			),

		confirm: (title, message, opts) =>
			createDialogPromise(
				opts,
				false,
				{
					method: "confirm",
					title,
					message,
					toolCallId: opts?.toolCallId,
					confirmText: opts?.confirmText,
					cancelText: opts?.cancelText,
					hookMeta: opts?.hookMeta,
				},
				(response) =>
					"cancelled" in response && response.cancelled ? false : "confirmed" in response ? response.confirmed : false,
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder }, (response) =>
				"cancelled" in response && response.cancelled
					? undefined
					: "value" in response
						? response.value
						: undefined,
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			options.output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			options.output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(_message?: string): void {},

		setWorkingVisible(_visible: boolean): void {},

		setWorkingIndicator(_options?: WorkingIndicatorOptions): void {},

		setHiddenThinkingLabel(_label?: string): void {},

		setWidget(key: string, content: unknown, widgetOptions?: ExtensionWidgetOptions): void {
			if (content === undefined || Array.isArray(content)) {
				options.output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: widgetOptions?.placement,
				} as RpcExtensionUIRequest);
			}
		},

		setFooter(_factory: unknown): void {},

		setHeader(_factory: unknown): void {},

		setTitle(title: string): void {
			options.output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			options.output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			return "";
		},

		editor(title: string, prefill?: string): Promise<string | undefined> {
			return createDialogPromise(
				undefined,
				undefined,
				{
					method: "editor",
					title,
					prefill,
				},
				(response) =>
					"cancelled" in response && response.cancelled
						? undefined
						: "value" in response
							? response.value
							: undefined,
			);
		},

		addAutocompleteProvider(): void {},

		setEditorComponent(): void {},

		getEditorComponent() {
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			return { success: false, error: "Theme setting not available in RPC mode" };
		},

		getToolsExpanded() {
			return false;
		},

		setToolsExpanded(_expanded: boolean) {},
	};
}
