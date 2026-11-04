import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const origin = 'https://ktnk226.github.io';
const env = { ALLOWED_ORIGIN: origin, GEMINI_API_KEY: 'test-key', RECEIPT_ACCESS_TOKEN: 'test-password', RATE_LIMITER: { limit: async () => ({ success: true }) } };
const request = (body, token = 'test-password', source = origin) => new Request('https://example.com/analyze', {
  method: 'POST', headers: { Origin: source, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const image = { mimeType: 'image/jpeg', data: btoa('\xff\xd8\xfftest') };
test('rejects unknown origin, bad password, unsupported images and rate excess', async () => {
  assert.equal((await worker.fetch(request(image, 'test-password', 'https://evil.example'), env)).status, 403);
  assert.equal((await worker.fetch(request(image, 'wrong'), env)).status, 401);
  assert.equal((await worker.fetch(request({ mimeType: 'image/jpeg', data: btoa('not an image') }), env)).status, 400);
  assert.equal((await worker.fetch(request(image), { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await worker.fetch(request(image), { ...env, GEMINI_API_KEY: '' })).status, 503);
});
test('forwards key only upstream and validates model output', async () => {
  const previous = globalThis.fetch;
  let result = { date: '2026-11-04', amount: 1200, store: 'テスト店舗', category: '雑費' };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert.ok(!url.includes('test-key'));
    assert.equal(JSON.parse(options.body).contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
  };
  try {
    const response = await worker.fetch(request(image), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.deepEqual(await response.json(), result);
    result.amount = -1;
    assert.equal((await worker.fetch(request(image), env)).status, 422);
    result.amount = 100; result.date = '2026-02-30';
    assert.equal((await worker.fetch(request(image), env)).status, 422);
    globalThis.fetch = async () => new Response('sensitive upstream error', { status: 403 });
    const failure = await worker.fetch(request(image), env);
    assert.equal(failure.status, 502);
    assert.ok(!(await failure.text()).includes('sensitive'));
  } finally { globalThis.fetch = previous; }
});
test('supports CORS preflight without authentication', async () => {
  const response = await worker.fetch(new Request('https://example.com/analyze', { method: 'OPTIONS', headers: { Origin: origin } }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('identifies each missing runtime setting without leaking secret values', async () => {
  for (const name of ['GEMINI_API_KEY', 'RECEIPT_ACCESS_TOKEN', 'RATE_LIMITER']) {
    const response = await worker.fetch(request(image), { ...env, [name]: undefined });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(body.includes(name));
    assert.ok(!body.includes('test-key'));
    assert.ok(!body.includes('test-password'));
  }
});
test('delivery endpoint uses delivery categories and rejects incompatible categories', async () => {
  const previous = globalThis.fetch;
  let receipt = { date: '2026-11-04', amount: 1800, store: '給油所', category: '燃料費' };
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.ok(prompt.includes('燃料費'));
    assert.ok(prompt.includes('駐車・通行料'));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(receipt) }] } }] });
  };
  const deliveryRequest = () => new Request('https://example.com/analyze-expense', {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer test-password', 'Content-Type': 'application/json' }, body: JSON.stringify(image)
  });
  try {
    const success = await worker.fetch(deliveryRequest(), env);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), receipt);
    receipt.category = '旅費交通費';
    assert.equal((await worker.fetch(deliveryRequest(), env)).status, 422);
  } finally { globalThis.fetch = previous; }
});
