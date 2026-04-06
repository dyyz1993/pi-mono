/**
 * 自定义数据卡片消息示例
 * 展示如何创建交互式自定义消息组件
 */
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { css } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { MessageRenderer, MessageRole } from "@mariozechner/pi-web-ui";
import { registerMessageRenderer } from "@mariozechner/pi-web-ui";

/**
 * 数据卡片项定义
 */
export interface DataCardItem {
	label: string;
	value: string | number;
	type?: "text" | "number" | "currency" | "percentage" | "date";
	color?: string;
}

/**
 * 数据卡片消息类型
 */
export interface DataCardMessage {
	role: MessageRole;
	type: "data-card";
	card: {
		title: string;
		description?: string;
		items: DataCardItem[];
		actions?: Array<{
			label: string;
			action: string;
			variant?: "primary" | "secondary" | "outline";
		}>;
		icon?: string; // SVG 图标字符串
	};
	// 用于回调的元数据
	metadata?: Record<string, any>;
}

/**
 * 自定义数据卡片组件
 */
@customElement("data-card-message")
export class DataCardMessage extends LitElement {
	static override styles = css`
		:host {
			display: block;
			margin: 0.5rem 0;
		}

		.card {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			border-radius: 0.75rem;
			padding: 1.25rem;
			color: white;
			box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
			animation: fadeIn 0.3s ease-out;
		}

		@keyframes fadeIn {
			from {
				opacity: 0;
				transform: translateY(-5px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}

		.header {
			display: flex;
			align-items: center;
			gap: 0.75rem;
			margin-bottom: 1rem;
		}

		.icon {
			width: 2rem;
			height: 2rem;
			opacity: 0.9;
		}

		.title-section {
			flex: 1;
		}

		.title {
			font-size: 1.125rem;
			font-weight: 600;
			margin: 0;
		}

		.description {
			font-size: 0.875rem;
			opacity: 0.9;
			margin-top: 0.25rem;
		}

		.items {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
			gap: 1rem;
			margin-bottom: 1rem;
		}

		.item {
			text-align: center;
			padding: 0.75rem;
			background: rgba(255, 255, 255, 0.1);
			border-radius: 0.5rem;
			backdrop-filter: blur(10px);
		}

		.item-value {
			font-size: 1.5rem;
			font-weight: 700;
			margin-bottom: 0.25rem;
		}

		.item-label {
			font-size: 0.75rem;
			opacity: 0.9;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		.actions {
			display: flex;
			gap: 0.5rem;
			flex-wrap: wrap;
		}

		button {
			padding: 0.5rem 1rem;
			border-radius: 0.375rem;
			font-size: 0.875rem;
			font-weight: 500;
			cursor: pointer;
			transition: all 0.15s ease;
			border: none;
		}

		button.primary {
			background: white;
			color: #667eea;
		}

		button.primary:hover {
			background: #f3f4f6;
			transform: translateY(-1px);
		}

		button.secondary {
			background: rgba(255, 255, 255, 0.2);
			color: white;
		}

		button.secondary:hover {
			background: rgba(255, 255, 255, 0.3);
		}

		button.outline {
			background: transparent;
			border: 1px solid rgba(255, 255, 255, 0.5);
			color: white;
		}

		button.outline:hover {
			background: rgba(255, 255, 255, 0.1);
			border-color: white;
		}

		.expand-button {
			margin-top: 0.75rem;
			background: rgba(255, 255, 255, 0.1);
			border: none;
			color: white;
			cursor: pointer;
			padding: 0.25rem 0.5rem;
			font-size: 0.75rem;
			border-radius: 0.25rem;
		}

		.expand-button:hover {
			background: rgba(255, 255, 255, 0.2);
		}

		.metadata {
			margin-top: 0.75rem;
			padding: 0.75rem;
			background: rgba(0, 0, 0, 0.2);
			border-radius: 0.5rem;
			font-family: monospace;
			font-size: 0.75rem;
			white-space: pre-wrap;
			word-break: break-all;
		}
	`;

	@property({ type: Object }) declare data: DataCardMessage;
	@state() private showMetadata = false;

	override render() {
		const { card, metadata } = this.data;

		const formatValue = (item: DataCardItem): string => {
			const { value, type } = item;
			switch (type) {
				case "currency":
					return typeof value === "number"
						? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
						: String(value);
				case "percentage":
					return typeof value === "number" ? `${value.toFixed(1)}%` : String(value);
				case "date":
					return new Date(value).toLocaleDateString();
				case "number":
					return typeof value === "number"
						? new Intl.NumberFormat("en-US").format(value)
						: String(value);
				default:
					return String(value);
			}
		};

		const handleAction = (action: string) => {
			// 发出自定义事件，父组件可以监听
			this.dispatchEvent(
				new CustomEvent("card-action", {
					detail: { action, metadata, card: this.data.card },
					bubbles: true,
					composed: true,
				}),
			);
		};

		return html`
			<div class="card">
				<div class="header">
					${card.icon ? unsafeHTML(`<div class="icon">${card.icon}</div>`) : ""}
					<div class="title-section">
						<h3 class="title">${card.title}</h3>
						${card.description ? html`<p class="description">${card.description}</p>` : ""}
					</div>
				</div>

				<div class="items">
					${card.items.map(
						(item) => html`
							<div class="item">
								<div class="item-value" style=${item.color ? `color: ${item.color}` : ""}>
									${formatValue(item)}
								</div>
								<div class="item-label">${item.label}</div>
							</div>
						`,
					)}
				</div>

				${card.actions
					? html`
							<div class="actions">
								${card.actions.map(
									(action) => html`
										<button
											class=${action.variant || "primary"}
											@click=${() => handleAction(action.action)}
										>
											${action.label}
										</button>
									`,
								)}
							</div>
						`
					: ""}

				${metadata
					? html`
							<button class="expand-button" @click=${() => (this.showMetadata = !this.showMetadata)}>
								${this.showMetadata ? "隐藏" : "显示"}元数据
							</button>
							${this.showMetadata
								? html`<div class="metadata">${JSON.stringify(metadata, null, 2)}</div>`
								: ""}
						`
					: ""}
			</div>
		`;
	}
}

/**
 * 判断消息是否为数据卡片消息
 */
export function isDataCardMessage(msg: any): msg is DataCardMessage {
	return msg && msg.type === "data-card" && msg.card !== undefined;
}

/**
 * 创建数据卡片消息
 */
export function createDataCard(
	title: string,
	items: DataCardItem[],
	options: {
		description?: string;
		actions?: DataCardMessage["card"]["actions"];
		icon?: string;
		metadata?: Record<string, any>;
		role?: MessageRole;
	} = {},
): DataCardMessage {
	return {
		role: options.role || "assistant",
		type: "data-card",
		card: {
			title,
			description: options.description,
			items,
			actions: options.actions,
			icon: options.icon,
		},
		metadata: options.metadata,
	};
}

/**
 * 数据卡片渲染器
 */
export const dataCardMessageRenderer: MessageRenderer = {
	canRender: (message: any): boolean => {
		return isDataCardMessage(message);
	},

	render: (message: DataCardMessage) => {
		const element = document.createElement("data-card-message") as DataCardMessage;
		element.data = message;
		return element;
	},
};

/**
 * 注册数据卡片渲染器
 */
export function registerDataCardMessageRenderer() {
	registerMessageRenderer(dataCardMessageRenderer);
}

/**
 * 使用示例：
 *
 * // 1. 注册渲染器
 * registerDataCardMessageRenderer();
 *
 * // 2. 创建数据卡片
 * const salesCard = createDataCard(
 *   "销售数据汇总",
 *   [
 *     { label: "总收入", value: 125000, type: "currency", color: "#10b981" },
 *     { label: "订单数", value: 1523, type: "number" },
 *     { label: "转化率", value: 23.5, type: "percentage" },
 *     { label: "平均订单额", value: 82.05, type: "currency" },
 *   ],
 *   {
 *     description: "2024年第一季度数据",
 *     icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
 *     actions: [
 *       { label: "查看详情", action: "view-details", variant: "primary" },
 *       { label: "导出报告", action: "export", variant: "outline" },
 *     ],
 *     metadata: {
 *       reportId: "sales-2024-q1",
 *       generatedAt: new Date().toISOString(),
 *     },
 *   },
 * );
 *
 * // 3. 在应用中监听卡片动作
 * document.addEventListener('card-action', (e) => {
 *   console.log('Card action:', e.detail);
 *   // e.detail = { action: string, metadata: any, card: DataCardMessage['card'] }
 * });
 */
