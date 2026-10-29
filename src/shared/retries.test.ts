import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveTransport } from './api';

afterEach(() => vi.unstubAllGlobals());
const ok = () => Response.json({ event_id: 'evt-23456789' });
const key = (init: RequestInit) => new Headers(init.headers).get('Idempotency-Key');

describe('live mutation retries', () => {
  it('uses one request key through an ambiguous network retry', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(init); if (requests.length === 1) throw new TypeError('connection lost after commit');
      return ok();
    }));
    await liveTransport.request('POST', '/api/stock/adjust', {body:{part_id:'retry-a',slot_id:'slot-a',delta:1}});
    expect(requests).toHaveLength(2);
    expect(key(requests[0])).toMatch(/^[a-f0-9-]{36}$/);
    expect(key(requests[1])).toBe(key(requests[0]));
  });
  it('keeps the receipt for a later user retry and creates a new one after success', async () => {
    const requests: RequestInit[] = []; let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(init); if (fail) throw new TypeError('offline'); return ok();
    }));
    const opts={body:{part_id:'retry-b',slot_id:'slot-b',delta:1}};
    await expect(liveTransport.request('POST','/api/stock/adjust',opts)).rejects.toThrow('request ID is preserved');
    fail=false;
    await liveTransport.request('POST','/api/stock/adjust',opts);
    await liveTransport.request('POST','/api/stock/adjust',opts);
    expect(key(requests[0])).toBe(key(requests[2]));
    expect(key(requests[3])).not.toBe(key(requests[2]));
  });
  it('keeps retry IDs on server uncertainty but never adds them to reads', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url:string,init:RequestInit)=>{requests.push(init);return Response.json({error:'database_unavailable'},{status:503});}));
    const opts={body:{part_id:'retry-c',delta:2}};
    await liveTransport.request('POST','/api/stock/adjust',opts);
    await liveTransport.request('POST','/api/stock/adjust',opts);
    await liveTransport.request('GET','/api/parts');
    expect(key(requests[0])).toBe(key(requests[1]));
    expect(key(requests[2])).toBeNull();
  });
  it('rejects a static HTML fallback as API data', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}})));
    await expect(liveTransport.request('GET','/api/me')).rejects.toThrow('did not return warehouse data');
  });
  it('preserves the same mutation receipt after a truncated or invalid JSON response', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(init);
      if (requests.length === 1) return new Response('{"event_id":', {headers: {'Content-Type': 'application/json'}});
      if (requests.length === 2) return Response.json(null);
      return ok();
    }));
    const opts = {body: {part_id: 'retry-truncated', slot_id: 'slot-a', delta: 1}};
    await expect(liveTransport.request('POST', '/api/stock/adjust', opts)).rejects.toThrow('response was incomplete');
    await expect(liveTransport.request('POST', '/api/stock/adjust', opts)).rejects.toThrow('response was incomplete');
    await liveTransport.request('POST', '/api/stock/adjust', opts);
    await liveTransport.request('POST', '/api/stock/adjust', opts);
    expect(key(requests[0])).toBe(key(requests[1]));
    expect(key(requests[1])).toBe(key(requests[2]));
    expect(key(requests[3])).not.toBe(key(requests[2]));
  });
});
