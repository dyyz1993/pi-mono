import { registerFauxProvider, fauxAssistantMessage } from '@dyyz1993/pi-ai';
import { Agent } from '@dyyz1993/pi-agent-core';
import { createReadTool } from './src/core/tools/index.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

(async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-debug-'));
	fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello world');

	const faux = registerFauxProvider();
	faux.setResponses([
		fauxAssistantMessage([
			{ type: 'text', text: 'Let me check.' },
			{ type: 'tool_call', id: 'tc_1', name: 'read', arguments: { path: path.join(tempDir, 'test.txt') } },
		]),
		fauxAssistantMessage('The file says hello world.'),
	]);

	const model = faux.getModel();
	const agent = new Agent({
		getApiKey: () => 'faux-key',
		initialState: {
			systemPrompt: 'Read files when asked.',
			model,
			thinkingLevel: 'off',
			tools: [createReadTool(tempDir)],
			messages: [],
		},
	});

	agent.subscribe((event: any, _signal: any) => {
		console.log('Event:', event.type);
		if (event.type === 'message_end') {
			const msg = event.message;
			console.log('  role:', msg.role, 'content:', JSON.stringify(msg.content).slice(0, 300));
		}
		if (event.type === 'agent_end') {
			console.log('  state messages:', agent.state.messages.length);
		}
	});

	try {
		await agent.prompt({ role: 'user', content: [{ type: 'text', text: 'Read test.txt' }], timestamp: Date.now() });
		console.log('Call count:', faux.state.callCount);
		console.log('Final messages:', agent.state.messages.length);
	} catch (e: any) {
		console.error('Error:', e.message);
	} finally {
		faux.unregister();
		fs.rmSync(tempDir, { recursive: true });
	}
})();
