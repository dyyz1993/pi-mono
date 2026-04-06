# Browser Extension Sandbox Usage Guide

## 📋 Overview

This guide explains how to use the `SandboxIframe` component in a browser extension environment where Content Security Policy (CSP) restrictions prevent the use of `srcdoc` or inline scripts.

## 🎯 The Problem

Browser extensions (especially Chrome) have strict CSP that:
- Blocks `srcdoc` attribute on iframes
- Blocks inline `<script>` tags (without `nonce` or `hash`)
- Requires all scripts to be loaded from the extension's own origin

## ✅ The Solution

Instead of using `srcdoc`, we:
1. Create a `sandbox.html` file in the extension
2. Load it via `chrome.runtime.getURL('sandbox.html')`
3. Inject user code through `postMessage` communication
4. Use the `RuntimeMessageRouter` for bidirectional communication

## 📁 Required Files

### 1. `sandbox.html`

Create this file in your extension directory:

```html
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Sandbox</title>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			font-size: initial; /* Reset Chrome's 75% font-size injection */
		}
	</style>
</head>
<body>
	<script src="sandbox.js"></script>
</body>
</html>
```

### 2. `sandbox.js`

Create this file in your extension directory:

```javascript
// sandbox.js - Runtime script for sandboxed iframe

let currentCode = null;

// Listen for code execution requests from parent
window.addEventListener('message', async (event) => {
	const { type, code, sandboxId, userCode, providers } = event.data;

	// Handle code injection
	if (type === 'inject-and-execute') {
		currentCode = userCode;
		await injectAndExecute(userCode, sandboxId, providers);
	}

	// Handle HTML content injection
	if (type === 'inject-html') {
		injectHtml(userCode, sandboxId, providers);
	}
});

// Inject and execute JavaScript code
async function injectAndExecute(userCode, sandboxId, providers) {
	try {
		// Clear previous content
		document.body.innerHTML = '';

		// Inject runtime bridge
		await injectRuntimeBridge(sandboxId, providers);

		// Execute user code
		const script = document.createElement('script');
		script.type = 'module';
		script.textContent = `
			(async () => {
				try {
					const userCodeFunc = async () => {
						${userCode}
					};
					const returnValue = await userCodeFunc();

					// Call completion callbacks
					if (window.__completionCallbacks) {
						await Promise.all(window.__completionCallbacks.map(cb => cb(true)));
					}

					await window.complete(null, returnValue);
				} catch (error) {
					if (window.__completionCallbacks) {
						await Promise.all(window.__completionCallbacks.map(cb => cb(false)));
					}
					await window.complete({
						message: error?.message || String(error),
						stack: error?.stack || new Error().stack
					});
				}
			})();
		`;
		document.body.appendChild(script);
	} catch (error) {
		console.error('Injection error:', error);
		window.parent.postMessage({
			type: 'execution-complete',
			sandboxId,
			success: false,
			error: {
				message: error.message,
				stack: error.stack
			}
		}, '*');
	}
}

// Inject HTML content
function injectHtml(userCode, sandboxId, providers) {
	try {
		// Inject runtime bridge
		injectRuntimeBridgeSync(sandboxId, providers);

		// Inject HTML content
		document.open();
		document.write(userCode);
		document.close();

		// Notify parent that HTML is loaded
		window.parent.postMessage({
			type: 'html-loaded',
			sandboxId,
			success: true
		}, '*');
	} catch (error) {
		console.error('HTML injection error:', error);
		window.parent.postMessage({
			type: 'html-loaded',
			sandboxId,
			success: false,
			error: {
				message: error.message,
				stack: error.stack
			}
		}, '*');
	}
}

// Inject runtime bridge (async version)
async function injectRuntimeBridge(sandboxId, providers) {
	// Inject data from providers
	if (providers) {
		for (const [key, value] of Object.entries(providers.data || {})) {
			window[key] = value;
		}
	}

	// Inject runtime bridge
	const bridgeScript = document.createElement('script');
	bridgeScript.textContent = generateRuntimeBridge(sandboxId);
	document.head.appendChild(bridgeScript);

	// Inject provider runtime functions
	if (providers && providers.runtimes) {
		for (const runtime of providers.runtimes) {
			const script = document.createElement('script');
			script.textContent = `(${runtime})(${JSON.stringify(sandboxId)});`;
			document.head.appendChild(script);
		}
	}
}

// Inject runtime bridge (sync version for HTML injection)
function injectRuntimeBridgeSync(sandboxId, providers) {
	window.sandboxId = sandboxId;

	// Inject data from providers
	if (providers && providers.data) {
		for (const [key, value] of Object.entries(providers.data)) {
			window[key] = value;
		}
	}

	// Inject bridge code inline
	const bridgeCode = generateRuntimeBridge(sandboxId);
	const script = document.createElement('script');
	script.textContent = bridgeCode;
	document.head.appendChild(script);

	// Inject provider runtime functions
	if (providers && providers.runtimes) {
		for (const runtime of providers.runtimes) {
			const script = document.createElement('script');
			script.textContent = `(${runtime})(${JSON.stringify(sandboxId)});`;
			document.head.appendChild(script);
		}
	}
}

// Generate runtime bridge code
function generateRuntimeBridge(sandboxId) {
	return `
		window.__completionCallbacks = [];

		window.sendRuntimeMessage = async (message) => {
			const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

			return new Promise((resolve, reject) => {
				const handler = (e) => {
					if (e.data.type === 'runtime-response' && e.data.messageId === messageId) {
						window.removeEventListener('message', handler);
						if (e.data.success) {
							resolve(e.data);
						} else {
							reject(new Error(e.data.error || 'Operation failed'));
						}
					}
				};

				window.addEventListener('message', handler);

				window.parent.postMessage({
					...message,
					sandboxId: ${JSON.stringify(sandboxId)},
					messageId: messageId
				}, '*');

				setTimeout(() => {
					window.removeEventListener('message', handler);
					reject(new Error('Runtime message timeout'));
				}, 30000);
			});
		};

		window.onCompleted = (callback) => {
			window.__completionCallbacks.push(callback);
		};

		// Navigation interceptor
		(function() {
			document.addEventListener('click', function(e) {
				const link = e.target.closest('a');
				if (link && link.href) {
					if (link.href.startsWith('http://') || link.href.startsWith('https://')) {
						e.preventDefault();
						e.stopPropagation();
						window.parent.postMessage({ type: 'open-external-url', url: link.href }, '*');
					}
				}
			}, true);

			document.addEventListener('submit', function(e) {
				const form = e.target;
				if (form && form.action) {
					e.preventDefault();
					e.stopPropagation();
					window.parent.postMessage({ type: 'open-external-url', url: form.action }, '*');
				}
			}, true);

			try {
				const originalLocation = window.location;
				Object.defineProperty(window, 'location', {
					get: function() { return originalLocation; },
					set: function(url) {
						window.parent.postMessage({ type: 'open-external-url', url: url.toString() }, '*');
					}
				});
			} catch (e) {}
		})();
	`.trim();
}
```

### 3. `manifest.json`

Update your manifest to include the sandbox files:

```json
{
	"manifest_version": 3,
	"name": "Your Extension",
	"version": "1.0.0",
	"permissions": ["activeTab"],
	"web_accessible_resources": [
		{
			"resources": ["sandbox.html", "sandbox.js"],
			"matches": ["<all_urls>"]
		}
	],
	"content_security_policy": {
		"extension_pages": "script-src 'self'; object-src 'self'"
	}
}
```

## 🚀 Usage Example

### Step 1: Set Up the Chat Panel

```typescript
import { ChatPanel } from "@mariozechner/web-ui";

// Create chat panel
const chatPanel = document.createElement('pi-chat-panel') as ChatPanel;

// Create agent
const agent = new Agent({
	apiKey: 'your-api-key',
	model: 'claude-sonnet-4',
	// ... other config
});

// Configure with sandbox URL provider
await chatPanel.setAgent(agent, {
	sandboxUrlProvider: () => chrome.runtime.getURL('sandbox.html'),
	
	// Optional: Custom tools factory
	toolsFactory: (agent, agentInterface, artifactsPanel, runtimeProvidersFactory) => {
		// Add custom tools here
		return [];
	}
});
```

### Step 2: The SandboxUrlProvider

The `sandboxUrlProvider` function is called by `SandboxIframe` when it needs to load the sandbox:

```typescript
// In SandboxIframe.loadContent()
if (this.sandboxUrlProvider) {
	// Use external sandbox.html
	const sandboxUrl = this.sandboxUrlProvider();
	iframe.src = sandboxUrl;
	
	// Wait for iframe to load
	iframe.addEventListener('load', () => {
		// Send code via postMessage
		iframe.contentWindow.postMessage({
			type: 'inject-html',
			sandboxId: sandboxId,
			userCode: htmlContent,
			providers: {
				data: providersData,
				runtimes: providersRuntimes
			}
		}, '*');
	});
}
```

## 🔧 Advanced: Custom Runtime Providers

You can create custom runtime providers to add functionality to sandboxes:

```typescript
import { SandboxRuntimeProvider } from "@mariozechner/web-ui";

export class MyCustomProvider implements SandboxRuntimeProvider {
	// Data to inject into sandbox window
	getData() {
		return {
			myCustomData: {
				version: '1.0.0',
				settings: { theme: 'dark' }
			}
		};
	}

	// Runtime function to inject into sandbox
	getRuntime() {
		return function(sandboxId: string) {
			// This code runs inside the sandbox
			window.myCustomFunction = async () => {
				const result = await window.sendRuntimeMessage({
					type: 'my-custom-message',
					data: { action: 'do-something' }
				});
				return result;
			};
		};
	}

	// Handle messages from sandbox
	async handleMessage?(message: any, respond: (response: any) => void) {
		if (message.type === 'my-custom-message') {
			// Handle message in parent context
			const result = await doSomethingInParent(message.data);
			respond({ success: true, result });
		}
	}
}
```

## 🎨 HTML Artifacts vs REPL

The sandbox supports two modes:

### 1. HTML Artifacts (Rendered HTML)
```typescript
// Used for rendering HTML/CSS/JS artifacts
chatPanel.loadContent(sandboxId, htmlContent, providers, consumers, {
	isHtmlArtifact: true
});
```

### 2. REPL (JavaScript Execution)
```typescript
// Used for JavaScript code execution
chatPanel.execute(sandboxId, jsCode, providers);
```

## 📡 Message Flow

```
┌─────────────────┐
│  Parent Window  │
│  (ChatPanel)    │
└────────┬────────┘
         │
         │ 1. Load sandbox.html
         ▼
┌─────────────────┐
│  Sandbox Iframe │
│  (sandbox.html) │
└────────┬────────┘
         │
         │ 2. postMessage: { type: 'inject-html', userCode, providers }
         ▼
┌─────────────────┐
│  Runtime Setup  │
│  - Inject data  │
│  - Inject APIs  │
└────────┬────────┘
         │
         │ 3. User code executes
         ▼
┌─────────────────┐
│  User Content   │
│  (HTML/JS)      │
└────────┬────────┘
         │
         │ 4. postMessage: { type: 'runtime-response', ... }
         ▼
┌─────────────────┐
│  Parent Window  │
│  (Response)     │
└─────────────────┘
```

## 🔒 Security Considerations

1. **Sandbox Attributes**: The iframe has these security restrictions:
   ```html
   <iframe sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox">
   ```

2. **No Remote Scripts**: The CSP prevents loading external scripts.

3. **Navigation Interception**: All navigation attempts are intercepted and opened in new tabs.

4. **Message Validation**: Always validate `sandboxId` in message handlers.

## 🐛 Troubleshooting

### Issue: "Refused to load sandbox.html"

**Cause**: Missing `web_accessible_resources` in manifest.

**Solution**:
```json
{
	"web_accessible_resources": [{
		"resources": ["sandbox.html", "sandbox.js"],
		"matches": ["<all_urls>"]
	}]
}
```

### Issue: Sandbox not receiving messages

**Cause**: Missing message event listener in `sandbox.js`.

**Solution**: Ensure `sandbox.js` has the message listener:
```javascript
window.addEventListener('message', async (event) => {
	// Handle messages
});
```

### Issue: CSP violations

**Cause**: Trying to use `srcdoc` or inline scripts.

**Solution**: Always use `sandboxUrlProvider` in extension context:
```typescript
sandboxUrlProvider: () => chrome.runtime.getURL('sandbox.html')
```

## 📚 API Reference

### ChatPanel.setAgent()

```typescript
interface AgentConfig {
	sandboxUrlProvider?: () => string;
	onApiKeyRequired?: (provider: string) => Promise<boolean>;
	onBeforeSend?: () => void | Promise<void>;
	onCostClick?: () => void;
	onModelSelect?: () => void;
	toolsFactory?: (
		agent: Agent,
		agentInterface: AgentInterface,
		artifactsPanel: ArtifactsPanel,
		runtimeProvidersFactory: () => SandboxRuntimeProvider[]
	) => AgentTool<any>[];
}
```

### SandboxUrlProvider

```typescript
type SandboxUrlProvider = () => string;
```

Function that returns the URL to the sandbox HTML file. Used in browser extensions to load `sandbox.html` via `chrome.runtime.getURL()`.

## 🎯 Summary

For browser extensions:
1. Create `sandbox.html` and `sandbox.js` files
2. Add them to `web_accessible_resources` in manifest
3. Pass `sandboxUrlProvider` to `ChatPanel.setAgent()`
4. The sandbox iframe will be loaded from the extension's own origin
5. Communication happens via `postMessage` and `RuntimeMessageRouter`

This approach satisfies CSP restrictions while maintaining all sandbox functionality!
