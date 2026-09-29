import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createFetchHandler } from './fetch.js';

function app() {
  const a = Fastify();
  a.get('/api/echo', async (req) => ({
    query: req.query,
    ip: req.ip,
    ua: req.headers['user-agent'],
  }));
  a.post('/api/echo', async (req, reply) => {
    reply.header('set-cookie', ['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly']);
    return { body: req.body };
  });
  a.post('/api/empty', async (_req, reply) => reply.status(204).send());
  return a;
}

describe('fetch adapter (ADR-0010 section 1)', () => {
  it('maps method, path, query, headers, and client address', async () => {
    const handle = createFetchHandler(app(), { clientAddress: () => '192.0.2.44' });
    const res = await handle(
      new Request('https://dev.example/api/echo?x=1&y=two', {
        headers: { 'user-agent': 'ua-test' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      query: { x: '1', y: 'two' },
      ip: '192.0.2.44',
      ua: 'ua-test',
    });
  });

  it('forwards the body and keeps every Set-Cookie header', async () => {
    const handle = createFetchHandler(app());
    const res = await handle(
      new Request('https://dev.example/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      }),
    );
    expect(await res.json()).toEqual({ body: { hello: 'world' } });
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly']);
  });

  it('returns empty bodies for 204 and passes 404s through', async () => {
    const handle = createFetchHandler(app());
    const empty = await handle(new Request('https://dev.example/api/empty', { method: 'POST' }));
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe('');
    const missing = await handle(new Request('https://dev.example/api/missing'));
    expect(missing.status).toBe(404);
  });
});
