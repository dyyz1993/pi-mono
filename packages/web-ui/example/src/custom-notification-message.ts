/**
 * 自定义消息组件示例
 * 展示如何创建自定义消息渲染器来渲染特殊类型的消息
 */

import type { MessageRenderer, MessageRole } from "@mariozechner/pi-web-ui";
import { registerMessageRenderer } from "@mariozechner/pi-web-ui";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * 自定义通知消息类型
 */
export interface NotificationMessage {
	role: MessageRole;
	type: "notification";
	notification: {
		title: string;
		message: string;
		level: "info" | "warning" | "error" | "success";
		timestamp: number;
	};
}

/**
 * 自定义通知消息组件
 */
@customElement("notification-message")
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: LitElement classes can safely extend interfaces
export class NotificationMessage extends LitElement {
	static override styles = css`
		:host {
			display: block;
			margin: 0.5rem 0;
		}

		.notification {
			padding: 1rem;
			border-radius: 0.5rem;
			border-left: 4px solid;
			background-color: var(--notification-bg, rgba(59, 130, 246, 0.1));
			animation: slideIn 0.3s ease-out;
		}

		@keyframes slideIn {
			from {
				opacity: 0;
				transform: translateX(-10px);
			}
			to {
				opacity: 1;
				transform: translateX(0);
			}
		}

		.notification.info {
			border-left-color: #3b82f6;
			--notification-bg: rgba(59, 130, 246, 0.1);
		}

		.notification.warning {
			border-left-color: #f59e0b;
			--notification-bg: rgba(245, 158, 11, 0.1);
		}

		.notification.error {
			border-left-color: #ef4444;
			--notification-bg: rgba(239, 68, 68, 0.1);
		}

		.notification.success {
			border-left-color: #10b981;
			--notification-bg: rgba(16, 185, 129, 0.1);
		}

		.header {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			margin-bottom: 0.5rem;
			font-weight: 600;
		}

		.icon {
			width: 1.25rem;
			height: 1.25rem;
		}

		.info .icon {
			color: #3b82f6;
		}

		.warning .icon {
			color: #f59e0b;
		}

		.error .icon {
			color: #ef4444;
		}

		.success .icon {
			color: #10b981;
		}

		.title {
			flex: 1;
		}

		.timestamp {
			font-size: 0.75rem;
			color: #6b7280;
			font-weight: 400;
		}

		.message {
			color: #374151;
			line-height: 1.5;
		}
	`;

	@property({ type: Object }) declare data: NotificationMessage;

	override render() {
		const { notification } = this.data;
		const level = notification.level || "info";

		const iconSvg = {
			info: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
			warning: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
			error: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
			success: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
		};

		const time = new Date(notification.timestamp);
		const timeStr = time.toLocaleTimeString();

		return html`
			<div class="notification ${level}">
				<div class="header">
					${iconSvg[level]}
					<span class="title">${notification.title}</span>
					<span class="timestamp">${timeStr}</span>
				</div>
				<div class="message">${notification.message}</div>
			</div>
		`;
	}
}

/**
 * 判断消息是否为通知消息
 */
export function isNotificationMessage(msg: any): msg is NotificationMessage {
	return msg && msg.type === "notification" && msg.notification !== undefined;
}

/**
 * 创建通知消息对象
 */
export function createNotification(
	title: string,
	message: string,
	level: "info" | "warning" | "error" | "success" = "info",
	role: MessageRole = "assistant",
): NotificationMessage {
	return {
		role,
		type: "notification",
		notification: {
			title,
			message,
			level,
			timestamp: Date.now(),
		},
	};
}

/**
 * 自定义消息渲染器
 * 将 NotificationMessage 渲染为 NotificationMessage 组件
 */
export const notificationMessageRenderer: MessageRenderer = {
	canRender: (message: any): boolean => {
		return isNotificationMessage(message);
	},

	render: (message: NotificationMessage) => {
		const element = document.createElement("notification-message") as NotificationMessage;
		element.data = message;
		return element;
	},
};

/**
 * 注册自定义消息渲染器
 */
export function registerNotificationMessageRenderer() {
	registerMessageRenderer(notificationMessageRenderer);
}

/**
 * 使用示例：
 *
 * // 1. 在应用启动时注册渲染器
 * registerNotificationMessageRenderer();
 *
 * // 2. 创建通知消息并添加到对话中
 * const notification = createNotification(
 *   "任务完成",
 *   "文件已成功导出到 /path/to/file",
 *   "success"
 * );
 * agent.sendMessage(notification);
 *
 * // 3. 或者在 Agent 的工具中返回通知消息
 * const myTool = createTool({
 *   name: "notify",
 *   description: "发送系统通知",
 *   parameters: z.object({
 *     title: z.string(),
 *     message: z.string(),
 *     level: z.enum(["info", "warning", "error", "success"]),
 *   }),
 *   execute: async (params) => {
 *     return createNotification(
 *       params.title,
 *       params.message,
 *       params.level
 *     );
 *   },
 * });
 */
