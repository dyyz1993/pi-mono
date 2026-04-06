/**
 * 自定义消息组件完整示例
 * 展示如何在实际应用中使用自定义消息
 */
import { Agent, createTool } from "@mariozechner/pi-agent-core";
import { z } from "zod";
import {
	registerNotificationMessageRenderer,
	createNotification,
	NotificationMessage,
} from "./custom-notification-message.js";
import {
	registerDataCardMessageRenderer,
	createDataCard,
	DataCardMessage,
	DataCardItem,
} from "./custom-data-card.js";

/**
 * 步骤 1: 注册所有自定义消息渲染器
 */
export function registerCustomMessageRenderers() {
	registerNotificationMessageRenderer();
	registerDataCardMessageRenderer();
	console.log("✅ Custom message renderers registered");
}

/**
 * 步骤 2: 创建返回自定义消息的工具
 */

// 示例工具：发送通知
export const notifyTool = createTool({
	name: "send_notification",
	description: "向用户发送系统通知",
	parameters: z.object({
		title: z.string().describe("通知标题"),
		message: z.string().describe("通知内容"),
		level: z.enum(["info", "warning", "error", "success"]).describe("通知级别"),
	}),
	execute: async (params) => {
		// 创建通知消息
		const notification = createNotification(params.title, params.message, params.level);
		// 返回通知消息作为工具结果
		return notification;
	},
});

// 示例工具：生成数据卡片
export const createDataCardTool = createTool({
	name: "create_data_card",
	description: "创建可视化数据卡片",
	parameters: z.object({
		title: z.string().describe("卡片标题"),
		description: z.string().optional().describe("卡片描述"),
		items: z
			.array(
				z.object({
					label: z.string().describe("数据标签"),
					value: z.union([z.string(), z.number()]).describe("数据值"),
					type: z.enum(["text", "number", "currency", "percentage", "date"]).optional(),
					color: z.string().optional(),
				}),
			)
			.describe("数据项列表"),
		actions: z
			.array(
				z.object({
					label: z.string().describe("按钮标签"),
					action: z.string().describe("动作标识"),
					variant: z.enum(["primary", "secondary", "outline"]).optional(),
				}),
			)
			.optional()
			.describe("可选的操作按钮"),
	}),
	execute: async (params) => {
		const card = createDataCard(params.title, params.items as DataCardItem[], {
			description: params.description,
			actions: params.actions,
			metadata: {
				source: "tool",
				createdAt: new Date().toISOString(),
			},
		});
		return card;
	},
});

/**
 * 步骤 3: 创建带自定义工具的 Agent
 */
export function createCustomAgent() {
	// 创建 Agent 时添加自定义工具
	const agent = new Agent({
		tools: [notifyTool, createDataCardTool],
		// ... 其他配置
	});

	return agent;
}

/**
 * 步骤 4: 在应用中监听自定义事件
 */
export function setupCustomMessageListeners(agent: Agent) {
	// 监听数据卡片的动作事件
	document.addEventListener("card-action", (event: Event) => {
		const customEvent = event as CustomEvent<{ action: string; metadata: any; card: any }>;
		const { action, metadata, card } = customEvent.detail;

		console.log("Card action triggered:", action);

		// 根据不同的动作执行不同的逻辑
		switch (action) {
			case "view-details":
				// 显示详细信息
				console.log("Viewing details for:", metadata);
				// 可以在这里触发 Agent 发起新的对话
				agent.sendMessage({
					role: "user",
					content: `查看 ${card.title} 的详细信息`,
				});
				break;

			case "export":
				// 导出数据
				console.log("Exporting:", metadata);
				agent.sendMessage({
					role: "user",
					content: `导出 ${card.title} 的报告`,
				});
				break;

			default:
				console.log("Unknown action:", action);
		}
	});
}

/**
 * 步骤 5: 手动创建和发送自定义消息
 */
export function manualSendExamples(agent: Agent) {
	// 发送通知消息
	const notification = createNotification("欢迎", "欢迎使用自定义消息系统!", "success");
	agent.sendMessage(notification);

	// 发送数据卡片
	const statsCard = createDataCard(
		"系统状态",
		[
			{ label: "CPU", value: "45%", type: "text" },
			{ label: "内存", value: "8.2 GB", type: "text" },
			{ label: "磁盘", value: 256, type: "number" },
		],
		{
			description: "实时系统监控",
			metadata: { server: "node-1" },
		},
	);
	agent.sendMessage(statsCard);
}

/**
 * 完整使用示例（在 main.ts 中）
 *
 * ```typescript
 * import { registerCustomMessageRenderers, createCustomAgent, setupCustomMessageListeners } from './custom-messages.js';
 *
 * // 1. 在应用启动时注册渲染器
 * registerCustomMessageRenderers();
 *
 * // 2. 创建 Agent
 * const agent = createCustomAgent();
 *
 * // 3. 设置事件监听器
 * setupCustomMessageListeners(agent);
 *
 * // 4. Agent 现在可以使用自定义工具返回自定义消息
 * // 当用户请求时，Agent 会自动调用 notifyTool 或 createDataCardTool
 * ```
 */

/**
 * 进阶用法：创建复合型自定义消息
 */

// 带有嵌入内容的消息
export interface EmbedMessage {
	role: "assistant" | "user";
	type: "embed";
	url: string;
	title: string;
	description?: string;
	thumbnail?: string;
}

@customElement("embed-message")
class EmbedMessage extends LitElement {
	static override styles = css`
		:host {
			display: block;
			margin: 0.5rem 0;
		}

		.embed-card {
			border: 1px solid #e5e7eb;
			border-radius: 0.5rem;
			overflow: hidden;
			max-width: 500px;
		}

		.thumbnail {
			width: 100%;
			height: 200px;
			object-fit: cover;
			background: #f3f4f6;
		}

		.content {
			padding: 1rem;
		}

		.title {
			font-weight: 600;
			color: #1f2937;
			margin-bottom: 0.5rem;
		}

		.description {
			font-size: 0.875rem;
			color: #6b7280;
			margin-bottom: 0.75rem;
		}

		.link {
			color: #3b82f6;
			text-decoration: none;
			font-size: 0.875rem;
		}

		.link:hover {
			text-decoration: underline;
		}
	`;

	@property({ type: Object }) declare data: EmbedMessage;

	override render() {
		return html`
			<div class="embed-card">
				${this.data.thumbnail
					? html`<img class="thumbnail" src=${this.data.thumbnail} alt=${this.data.title} />`
					: ""}
				<div class="content">
					<div class="title">${this.data.title}</div>
					${this.data.description ? html`<div class="description">${this.data.description}</div>` : ""}
					<a class="link" href=${this.data.url} target="_blank" rel="noopener noreferrer">
						${new URL(this.data.url).hostname} →
					</a>
				</div>
			</div>
		`;
	}
}

// 注册 embed 渲染器（简化版本，实际使用时需要导入 customElement）
export const embedMessageRenderer: MessageRenderer = {
	canRender: (message: any) => message && message.type === "embed" && message.url,
	render: (message: EmbedMessage) => {
		const element = document.createElement("embed-message") as EmbedMessage;
		element.data = message;
		return element;
	},
};

/**
 * 提示：
 * - 自定义消息必须是纯数据对象（可序列化）
 * - 组件负责渲染和交互逻辑
 * - 使用 CustomEvent 与外部通信
 * - 可以通过 metadata 传递额外的上下文信息
 */

// 需要导入的依赖
import { css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LitElement } from "lit";
import type { MessageRenderer } from "@mariozechner/pi-web-ui";
import { registerMessageRenderer } from "@mariozechner/pi-web-ui";
