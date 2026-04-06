# Quick Start: Browser Extension Sandbox

## 5-Minute Setup

### 1. Create `sandbox.html`

```html
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		html, body { margin: 0; padding: 0; width: 100%; height: 100%; font-size: initial; }
	</style>
</head>
<body>
	<script src="sandbox.js"></script>
</body>
</html>
```

### 2. Create `sandbox.js`

```javascript
window.addEventListener('message', async (event) => {
	const { type, userCode, sandboxId, providers } = event.data;

	if (type === 'inject-html') {
		// Inject runtime bridge
		window.sandboxId = sandboxId;
		if (providers?.data) {
			Object.entries(providers.data).forEach(([k, v]) => window[k] = v);
		}

		// Inject HTML content
		document.open();
		document.write(userCode);
		document.close();

		// Notify parent
		window.parent.postMessage({ type: 'html-loaded', sandboxId, success: true }, '*');
	}
});
```

### 3. Update `manifest.json`

```json
{
	"web_accessible_resources": [{
		"resources": ["sandbox.html", "sandbox.js"],
		"matches": ["<all_urls>"]
	}]
}
```

### 4. Use in Your Extension

```typescript
import { ChatPanel } from "@mariozechner/web-ui";

const chatPanel = document.createElement('pi-chat-panel') as ChatPanel;

await chatPanel.setAgent(agent, {
	sandboxUrlProvider: () => chrome.runtime.getURL('sandbox.html')
});
```

That's it! Your sandbox is now CSP-compliant.

---

**Full documentation**: See [BROWSER_EXTENSION_SANDBOX.md](./BROWSER_EXTENSION_SANDBOX.md)
