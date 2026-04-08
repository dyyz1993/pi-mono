/**
 * 测试 Bug: endSession 在 config.enabled = false 时传入错误的 tokensAfter
 */

import { compressContext } from "./src/core/context-compression/index.js";
import type { Message } from "@sourcegraph/cody-shared";

// 创建测试消息
const messages: Message[] = [
	{
		speaker: "human",
		text: "Hello, this is a test message that should be long enough to have some tokens.",
	},
	{
		speaker: "assistant",
		text: "This is a response that also needs to be reasonably long to have tokens.",
	},
	{
		speaker: "human",
		text: "Another message to make the conversation longer.",
	},
	{
		speaker: "assistant",
		text: "And another response to continue the conversation.",
	},
];

async function testBug() {
	console.log("=== 测试 config.enabled = false 的情况 ===\n");

	// 设置环境变量启用日志
	process.env.CODING_AGENT_LOG_DIR = "/tmp/compression-test-logs";

	// 测试 1: config.enabled = false
	console.log("测试 1: 压缩功能禁用时 (config.enabled = false)");
	const result1 = await compressContext(messages, {
		enabled: false,
		intent: "code",
		availableTokens: 100000,
		threshold: 0.8,
		strategies: {
			pruning: { enabled: false },
			summarization: { enabled: false },
		},
	});

	console.log("结果:");
	console.log(`  tokensBefore: ${result1.tokensBefore}`);
	console.log(`  tokensAfter: ${result1.tokensAfter}`);
	console.log(`  savedTokens: ${result1.tokensBefore - result1.tokensAfter}`);
	console.log(`  savedPercent: ${((result1.tokensBefore - result1.tokensAfter) / result1.tokensBefore * 100).toFixed(1)}%`);
	console.log();

	// 测试 2: config.enabled = true (但实际不会压缩，因为 token 使用量低)
	console.log("测试 2: 压缩功能启用但不需要压缩");
	const result2 = await compressContext(messages, {
		enabled: true,
		intent: "code",
		availableTokens: 100000,
		threshold: 0.8,
		strategies: {
			pruning: { enabled: true },
			summarization: { enabled: true },
		},
	});

	console.log("结果:");
	console.log(`  tokensBefore: ${result2.tokensBefore}`);
	console.log(`  tokensAfter: ${result2.tokensAfter}`);
	console.log(`  savedTokens: ${result2.tokensBefore - result2.tokensAfter}`);
	console.log(`  savedPercent: ${((result2.tokensBefore - result2.tokensAfter) / result2.tokensBefore * 100).toFixed(1)}%`);
	console.log();

	console.log("=== Bug 分析 ===");
	console.log("在 src/core/context-compression/index.ts:59 行:");
	console.log("  当 config.enabled = false 时,");
	console.log("  调用: compressionLogger.endSession(tokensBefore, ...)");
	console.log("  应该调用: compressionLogger.endSession(tokensAfter, ...)");
	console.log();
	console.log("这导致 logger 中的 savedTokens 计算错误:");
	console.log("  savedTokens = tokensBefore - tokensBefore = 0");
	console.log("  而实际应该是: savedTokens = tokensBefore - tokensAfter");
}

testBug().catch(console.error);
