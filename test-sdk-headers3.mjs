const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  console.log('URL:', url);
  const headers = {};
  if (opts?.headers) {
    if (opts.headers instanceof Headers) {
      for (const [k,v] of opts.headers) headers[k] = v;
    } else Object.assign(headers, opts.headers);
  }
  console.log('ALL HEADERS:', JSON.stringify(headers, null, 2));
  const resp = await origFetch(url, opts);
  const text = await resp.text();
  console.log('STATUS:', resp.status);
  console.log('RESP:', text.substring(0, 300));
  return new Response(text, { status: resp.status, headers: resp.headers });
};
import Anthropic from '@anthropic-ai/sdk';
// Exact replica of how pi creates the client for glm provider
const client = new Anthropic({
  apiKey: 'pk-2edc47d6-4e16-48c2-935c-2dc3dfad2d1a',
  baseURL: 'https://modelservice.jdcloud.com/coding/anthropic',
  dangerouslyAllowBrowser: true,
  defaultHeaders: {
    accept: 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
    'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
    'x-api-key': 'pk-2edc47d6-4e16-48c2-935c-2dc3dfad2d1a',
    'anthropic-version': '2023-06-01',
  },
});
try {
  const msg = await client.messages.create({
    model: 'DeepSeek-V3.2',
    max_tokens: 4096,
    system: 'You are a helpful assistant.',
    messages: [{role: 'user', content: 'hello'}],
  });
  console.log('SUCCESS:', msg.content[0]?.text?.substring(0, 100));
} catch(e) { console.error('Error:', e.message); }
