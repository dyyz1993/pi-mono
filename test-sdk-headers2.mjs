const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  console.log('URL:', url);
  const resp = await origFetch(url, opts);
  const text = await resp.text();
  console.log('STATUS:', resp.status);
  console.log('BODY:', text.substring(0, 200));
  return new Response(text, { status: resp.status, headers: resp.headers });
};
import Anthropic from '@anthropic-ai/sdk';
// Test with TRAILING slash (like pi may use)
const client = new Anthropic({
  apiKey: 'pk-2edc47d6-4e16-48c2-935c-2dc3dfad2d1a',
  baseURL: 'https://modelservice.jdcloud.com/coding/anthropic/',
});
try {
  await client.messages.create({
    model: 'DeepSeek-V3.2',
    max_tokens: 4096,
    messages: [{role: 'user', content: 'hello'}],
  });
} catch(e) { console.error('Error:', e.message); }
