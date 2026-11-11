import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, authenticateFromFragment, consumeBootstrap, LOCAL_SESSION_KEY, LocalSession, localSession, safeErrorMessage } from '../src/api';

const BOOTSTRAP = 'SYNTHETIC_BOOTSTRAP_'.repeat(3);
const REQUEST_TOKEN = 'SYNTHETIC_APP_VERIFIER_'.repeat(3);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

beforeEach(() => localSession.clear());
afterEach(() => { localSession.clear(); vi.unstubAllGlobals(); });

describe('own local app session authorization', () => {
  it('removes the fragment before exchanging the bootstrap and retains only the returned verifier', async () => {
    const order: string[] = [];
    const history = { replaceState: vi.fn(() => order.push('fragment_removed')) };
    const fetch = vi.fn(async (_url, options: RequestInit) => {
      order.push('requested');
      expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?view=overview');
      expect(new Headers(options.headers).has('X-AI-Quota-Session')).toBe(false);
      expect(JSON.parse(String(options.body))).toEqual({ bootstrap: BOOTSTRAP });
      return Response.json({ request_token: REQUEST_TOKEN });
    });
    vi.stubGlobal('fetch', fetch);
    await authenticateFromFragment({ hash: `#bootstrap=${BOOTSTRAP}`, pathname: '/', search: '?view=overview' }, history);
    expect(order).toEqual(['fragment_removed', 'requested']);
    expect(localSession.value).toBe(REQUEST_TOKEN);
    expect(localSession.value).not.toBe(BOOTSTRAP);
  });

  it('clears malformed fragments without storing or sending them', () => {
    const history = { replaceState: vi.fn() };
    expect(consumeBootstrap({ hash: '#bootstrap=unsafe%20value', pathname: '/', search: '' }, history)).toBeNull();
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(localSession.value).toBeNull();
  });

  it('sends the verifier only to the local same-origin API with the session cookie', async () => {
    localSession.set(REQUEST_TOKEN);
    const fetch = vi.fn(async () => Response.json({ accounts: [] }));
    vi.stubGlobal('fetch', fetch);
    await api.accounts();
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/accounts');
    expect(options.credentials).toBe('same-origin');
    expect(options.cache).toBe('no-store');
    expect(new Headers(options.headers).get('X-AI-Quota-Session')).toBe(REQUEST_TOKEN);
  });

  it('uses only the single own-session storage key and has a memory fallback', () => {
    const storage = memoryStorage();
    const session = new LocalSession(storage);
    session.set(REQUEST_TOKEN);
    expect([...storage.values.keys()]).toEqual([LOCAL_SESSION_KEY]);
    expect(new LocalSession(storage).value).toBe(REQUEST_TOKEN);
    session.clear();
    expect(storage.values.size).toBe(0);
    const blocked = new LocalSession({
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    });
    blocked.set(REQUEST_TOKEN);
    expect(blocked.value).toBe(REQUEST_TOKEN);
    expect(blocked.memoryOnly).toBe(true);
  });

  it('clears authorization on 401 without exposing upstream text', async () => {
    localSession.set(REQUEST_TOKEN);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'SYNTHETIC_PRIVATE_VALUE' }, { status: 401 })));
    let caught: unknown;
    try { await api.accounts(); } catch (error) { caught = error; }
    expect(localSession.value).toBeNull();
    expect(caught).toBeInstanceOf(ApiError);
    expect(safeErrorMessage(caught)).not.toContain('SYNTHETIC_PRIVATE_VALUE');
    expect(safeErrorMessage(caught)).toContain('本地会话');
  });

  it('clears the local verifier when locking even if the server is unreachable', async () => {
    localSession.set(REQUEST_TOKEN);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network details'); }));
    await expect(api.lock()).rejects.toBeInstanceOf(ApiError);
    expect(localSession.value).toBeNull();
  });
});

describe('summary failures stay unavailable', () => {
  it('does not turn malformed summary responses into an empty or zero allowance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ snapshots: [{ account_id: 'synthetic-account', observation: { remaining_percent: null } }] })));
    await expect(api.snapshots()).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('does not reflect a raw HTML error or a parser error into the UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>SYNTHETIC_PRIVATE_VALUE</html>', { status: 500 })));
    let caught: unknown;
    try { await api.accounts(); } catch (error) { caught = error; }
    expect(safeErrorMessage(caught)).toBe('操作未完成，请稍后重试。');
    expect(safeErrorMessage(new Error('SYNTHETIC_PRIVATE_VALUE'))).not.toContain('SYNTHETIC_PRIVATE_VALUE');
  });
});
