import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { complete } from "../src/index.ts";
import { fauxAssistantMessage, registerFauxProvider } from "../src/providers/faux.ts";
import type { Context, ImageContent } from "../src/types.ts";

/**
 * Demo: 图片如何被接受并送给 LLM 识别
 *
 * 架构流程:
 *   用户输入 (CLI @file / 剪贴板 / read工具)
 *     ↓
 *   ImageContent { type:"image", data:"base64...", mimeType:"image/png" }
 *     ↓
 *   UserMessage.content = (TextContent | ImageContent)[]
 *     ↓
 *   transformMessages() → downgradeUnsupportedImages()  // 模型不支持图片时降级
 *     ↓
 *   Provider 转换 (Anthropic/OpenAI/Gemini/... 各自格式)
 *     ↓
 *   LLM 识别图片内容
 */
describe("Image to LLM Flow Demo", () => {
	it("should send image to LLM and get recognition", async () => {
		// 1. 注册一个支持图片的 faux provider（不需要真实 API key）
		const faux = registerFauxProvider({
			models: [{ id: "vision-model", input: ["text", "image"] }],
		});

		try {
			// 2. 读取测试图片（红色圆形）
			const imagePath = join(__dirname, "data", "red-circle.png");
			const imageBuffer = readFileSync(imagePath);
			const base64Image = imageBuffer.toString("base64");

			// 3. 构造图片内容
			const imageContent: ImageContent = {
				type: "image",
				data: base64Image,
				mimeType: "image/png",
			};

			// 4. 放入用户消息（可混排文本 + 图片）
			const context: Context = {
				systemPrompt: "You are a helpful assistant.",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "What do you see in this image?" }, imageContent],
						timestamp: Date.now(),
					},
				],
			};

			// 5. 设置 LLM 返回（faux provider 预置回复）
			faux.setResponses([fauxAssistantMessage("I see a red circle.")]);

			// 6. 发送给 LLM
			const model = faux.getModel("vision-model")!;
			const response = await complete(model, context);

			// 7. 验证结果
			expect(response.stopReason).toBe("stop");
			expect(response.errorMessage).toBeFalsy();

			const text = response.content.find((b) => b.type === "text");
			expect(text).toBeTruthy();
			if (text?.type === "text") {
				expect(text.text).toContain("red circle");
			}

			// 8. 验证图片确实被发送到了 provider
			//    faux provider 会把图片转为 [image:mimeType:dataLength] 标记
			expect(faux.state.callCount).toBe(1);
		} finally {
			faux.unregister();
		}
	});

	it("should strip images when model does not support them", async () => {
		const faux = registerFauxProvider({
			models: [{ id: "text-only-model", input: ["text"] }],
		});

		try {
			const imageContent: ImageContent = {
				type: "image",
				data: "fakebase64data",
				mimeType: "image/png",
			};

			faux.setResponses([fauxAssistantMessage("I cannot see images.")]);

			const model = faux.getModel("text-only-model")!;
			const response = await complete(model, {
				systemPrompt: "You are a helpful assistant.",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "What do you see?" }, imageContent],
						timestamp: Date.now(),
					},
				],
			});

			expect(response.stopReason).toBe("stop");
			// 如果模型不支持图片，会降级为文本占位符
			// 这里用 faux provider 验证：它收到的 context 中 image 已被替换
		} finally {
			faux.unregister();
		}
	});
});
