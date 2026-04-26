/**
 * 手动验证 auto-session-title 扩展 + session_rename 事件的端到端脚本。
 *
 * 用法: npx tsx test/suite/run-auto-session-title.ts
 *
 * 流程:
 * 1. 创建带扩展的 harness（含 session_rename 监听）
 * 2. 发送第一条用户消息 → 触发 turn_end → callLLM 生成标题 → session_rename 事件
 * 3. 打印过程中所有事件日志，重点关注 session_rename
 * 4. 发送第二条消息 → 验证不会重复生成（session_rename 不再触发）
 * 5. 最终调用 getSessionName() 验证结果
 */

import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import type { SessionEntry, SessionMessageEntry } from "../../src/index.js";
import { createHarness, type Harness } from "./harness.js";

const TITLE_PROMPT =
	"Generate a very short title (max 50 characters) for a coding conversation that starts with this message. Output ONLY the title, nothing else. No quotes, no punctuation at the end.";

const MAX_TITLE_LENGTH = 100;
const MAX_LLM_TOKENS = 30;

function extractFirstUserText(entries: SessionEntry[]): string {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = (entry as SessionMessageEntry).message;
		if (msg.role !== "user") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const texts = content
				.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
				.map((c) => c.text)
				.join("\n");
			if (texts) return texts;
		}
	}
	return "";
}

function cleanLLMTitle(raw: string): string {
	const withoutThink = raw.replace(/<think[\s\S]*?<\/think\s*>?/g, "");
	return (
		withoutThink
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)[0]
			?.slice(0, MAX_TITLE_LENGTH)
			.trim() ?? ""
	);
}

function log(tag: string, ...args: unknown[]) {
	console.log(`[${new Date().toISOString().slice(11, 23)}] [${tag}]`, ...args);
}

async function main() {
	console.log("=".repeat(60));
	console.log("auto-session-title + session_rename 端到端验证");
	console.log("=".repeat(60));

	// 收集 session_rename 事件
	const renameEvents: Array<{ oldName: string | undefined; newName: string }> = [];

	// ── Step 1: 创建 harness，注入扩展 ──
	log("SETUP", "创建 harness + 扩展 (auto-session-title + session_rename 监听)...");

	const extensionFactory = (pi: import("../../src/index.js").ExtensionAPI) => {
		// ★ 核心：监听 session_rename 事件
		pi.on("session_rename", async (event) => {
			renameEvents.push({ oldName: event.oldName, newName: event.newName });
			log("EVENT", `★ session_rename: oldName="${event.oldName ?? "(无)"}" → newName="${event.newName}"`);
		});

		pi.on("session_start", async (event) => {
			log("EVENT", `session_start: reason=${event.reason}`);
		});

		pi.on("turn_start", async (event) => {
			log("EVENT", `turn_start: turnIndex=${event.turnIndex}`);
		});

		pi.on("turn_end", async (event, ctx) => {
			log("EVENT", `turn_end: turnIndex=${event.turnIndex}`);

			if (event.turnIndex !== 0) {
				log("SKIP", `turnIndex=${event.turnIndex} 不是第一轮，跳过自动命名`);
				return;
			}

			const existingName = pi.getSessionName();
			log("CHECK", `已有 session name: ${existingName ?? "(无)"}`);
			if (existingName) {
				log("SKIP", "session 已有名称，跳过自动命名");
				return;
			}

			const entries = ctx.sessionManager.getEntries();
			const userText = extractFirstUserText(entries);
			log("CHECK", `提取到用户消息: "${userText.slice(0, 60)}${userText.length > 60 ? "..." : ""}"`);
			if (!userText) return;

			let title = "";
			try {
				log("CALL", "调用 pi.callLLM() 生成标题...");
				title = await pi.callLLM({
					systemPrompt: TITLE_PROMPT,
					messages: [{ role: "user", content: userText }],
					maxTokens: MAX_LLM_TOKENS,
				});
				log("CALL", `callLLM 原始返回: "${title}"`);
			} catch (e) {
				log("ERROR", `callLLM 失败: ${e}`);
				return;
			}

			const cleaned = cleanLLMTitle(title);
			log("CLEAN", `清理后标题: "${cleaned}" (长度: ${cleaned.length})`);

			if (cleaned) {
				log("SET", `调用 pi.setSessionName("${cleaned}") ...`);
				pi.setSessionName(cleaned);
				log("SET", `pi.setSessionName() 返回（应已触发 session_rename 事件）`);

				const verified = pi.getSessionName();
				log("VERIFY", `pi.getSessionName() 返回: "${verified}"`);
			}
		});

		pi.on("agent_start", async () => log("EVENT", "agent_start"));
		pi.on("agent_end", async () => log("EVENT", "agent_end"));
		pi.on("message_start", async (e) => log("EVENT", `message_start: role=${e.message.role}`));
		pi.on("message_end", async (e) => log("EVENT", `message_end: role=${e.message.role}`));
	};

	const harness: Harness = await createHarness({
		extensionFactories: [extensionFactory],
	});

	log("SETUP", "harness 创建完成");

	// ── Step 2: 第一次对话 → 应该触发自动命名 + session_rename ──
	console.log(`\n${"-".repeat(60)}`);
	log("STEP1", "=== 第一轮对话 (应该触发 session_rename) ===");

	harness.setResponses([
		fauxAssistantMessage("我来看看那个登录 bug 的问题..."),
		fauxAssistantMessage("修复登录页面 bug"),
	]);

	log("STEP1", '发送用户消息: "帮我修一下登录页面的 bug"');
	await harness.session.prompt("帮我修一下登录页面的 bug");
	log("STEP1", "prompt() 完成");

	// ── Step 3: 检查结果 ──
	console.log(`\n${"-".repeat(60)}`);
	log("RESULT", "=== 第一轮结果 ===");

	const nameAfterFirst = harness.sessionManager.getSessionName();
	log("RESULT", `getSessionName() = "${nameAfterFirst}"`);
	log("RESULT", `session_rename 事件数: ${renameEvents.length}`);
	if (renameEvents.length > 0) {
		log("RESULT", `  事件[0]: oldName="${renameEvents[0].oldName ?? "(无)"}" → newName="${renameEvents[0].newName}"`);
	}

	// ── Step 4: 第二次对话 → 不应该触发 session_rename ──
	console.log(`\n${"-".repeat(60)}`);
	log("STEP2", "=== 第二轮对话 (不应该再触发 session_rename) ===");

	harness.setResponses([fauxAssistantMessage("好的，继续修。")]);
	log("STEP2", '发送用户消息: "继续修"');
	await harness.session.prompt("继续修");
	log("STEP2", "prompt() 完成");

	console.log(`\n${"-".repeat(60)}`);
	log("RESULT", "=== 第二轮结果 ===");

	const nameAfterSecond = harness.sessionManager.getSessionName();
	log("RESULT", `getSessionName() = "${nameAfterSecond}"`);
	log("RESULT", `session_rename 事件数: ${renameEvents.length} (应仍为 1)`);

	// ── Step 5: 最终汇总 ──
	console.log(`\n${"=".repeat(60)}`);
	log("SUMMARY", "=== 最终汇总 ===");
	log("SUMMARY", `session name: "${nameAfterSecond}"`);
	log("SUMMARY", `session_rename 事件总数: ${renameEvents.length}`);
	log("SUMMARY", `faux callCount: ${harness.faux.state.callCount}`);

	let allPassed = true;

	if (renameEvents.length !== 1) {
		log("FAIL", `session_rename 事件数: 预期 1, 实际 ${renameEvents.length}`);
		allPassed = false;
	} else {
		log("PASS", "session_rename 事件恰好触发 1 次");
	}

	if (renameEvents[0]?.oldName !== undefined) {
		log("FAIL", `oldName 预期 undefined, 实际 "${renameEvents[0]?.oldName}"`);
		allPassed = false;
	} else {
		log("PASS", "session_rename.oldName = undefined (首次命名)");
	}

	if (renameEvents[0]?.newName !== "修复登录页面 bug") {
		log("FAIL", `newName 预期 "修复登录页面 bug", 实际 "${renameEvents[0]?.newName}"`);
		allPassed = false;
	} else {
		log("PASS", `session_rename.newName = "${renameEvents[0]?.newName}"`);
	}

	if (nameAfterSecond !== "修复登录页面 bug") {
		log("FAIL", `最终 session name 预期 "修复登录页面 bug", 实际 "${nameAfterSecond}"`);
		allPassed = false;
	} else {
		log("PASS", "最终 session name 正确且未被第二轮覆盖");
	}

	if (allPassed) {
		log("PASS", "★ 所有检查通过！");
	} else {
		log("FAIL", "存在失败的检查项");
	}

	harness.cleanup();
	log("DONE", "清理完成");
	console.log("=".repeat(60));
}

main().catch((e) => {
	console.error("Fatal:", e);
	process.exit(1);
});
