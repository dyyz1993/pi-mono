const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  console.log('URL:', url);
  const resp = await origFetch(url, opts);
  console.log('STATUS:', resp.status);
  if (resp.ok) {
    const text = await resp.text();
    console.log('OK! Response:', text.substring(0, 200));
  } else {
    const text = await resp.text();
    console.log('ERROR:', text.substring(0, 300));
  }
  return new Response(text, { status: resp.status, headers: resp.headers });
};
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  apiKey: 'pk-2edc47d6-4e16-48c2-935c-2dc3dfad2d1a',
  baseURL: 'https://modelservice.jdcloud.com/coding/anthropic',
});
try {
  const msg = await client.messages.create({
    model: 'DeepSeek-V3.2',
    max_tokens: 4096,
    system: 'You are helpful.',
    messages: [{role: 'user', content: 'hello'}],
  });
  console.log('RESPONSE:', JSON.stringify(msg.content).substring(0, 200));
} catch(e) { console.error('Error:', e.message); }
