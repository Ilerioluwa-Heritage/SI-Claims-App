import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAccess, closedPage, forgetKeys, onRequest, teamAddress, type AccessKey } from '../src/gate/access.ts';

// The sign-in check in front of the online website. Tokens here are signed
// with keys made up for the test, standing in for Cloudflare Access's own.

const TEAM = 'ul-si';
const ISSUER = 'https://ul-si.cloudflareaccess.com';
const NOW = Math.floor(Date.now() / 1000);
const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const makeKeys = () =>
  crypto.subtle.generateKey({ ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
const accessKeys = await makeKeys();
const otherKeys = await makeKeys();
const publicKey = { ...(await crypto.subtle.exportKey('jwk', accessKeys.publicKey)), kid: 'key-1' } as AccessKey;

const b64 = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');

async function token(claims: object, { kid = 'key-1', alg = 'RS256', key = accessKeys.privateKey } = {}) {
  const head = b64(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(signature)}`;
}

const signedIn = { iss: ISSUER, aud: ['app-tag'], email: 'admin@example.com', type: 'app', iat: NOW, nbf: NOW, exp: NOW + 3600 };

let fetched: string[];
const getKeys = async (address: string) => {
  fetched.push(address);
  return [publicKey];
};
const check = (t: string | null) => checkAccess(t, TEAM, { getKeys, now: NOW });

beforeEach(() => {
  forgetKeys();
  fetched = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sign-in check in front of the website', () => {
  it('lets in a visitor that Cloudflare Access signed in', async () => {
    expect(await check(await token(signedIn))).toEqual({ open: true });
    expect(fetched).toEqual([ISSUER]);
  });

  it('stays closed until the team setting is filled in, and accepts it written three ways', async () => {
    for (const team of [undefined, '', '  ', 'https://example.com', 'ul-si.example.com', 'ul si', 'ul-si.cloudflareaccess.com/cdn-cgi']) {
      expect(await checkAccess(await token(signedIn), team, { getKeys, now: NOW })).toEqual({ open: false, reason: 'not-set-up' });
    }
    for (const team of ['ul-si', 'UL-SI.cloudflareaccess.com', 'https://ul-si.cloudflareaccess.com/']) {
      expect(teamAddress(team)).toBe(ISSUER);
    }
  });

  it('stays closed for a visitor Access did not sign in', async () => {
    expect(await check(null)).toEqual({ open: false, reason: 'no-token' });
    expect(await check('')).toEqual({ open: false, reason: 'no-token' });
  });

  it('stays closed for a token that was changed, or signed with any other key', async () => {
    const [head, , signature] = (await token(signedIn)).split('.');
    const longer = b64(JSON.stringify({ ...signedIn, exp: NOW + 999_999 }));
    expect(await check(`${head}.${longer}.${signature}`)).toEqual({ open: false, reason: 'bad-token' });
    expect(await check(await token(signedIn, { key: otherKeys.privateKey }))).toEqual({ open: false, reason: 'bad-token' });
  });

  it('stays closed for an unsigned token, or one claiming another kind of signature', async () => {
    const [head, body] = (await token(signedIn, { alg: 'none' })).split('.');
    expect(await check(`${head}.${body}.`)).toEqual({ open: false, reason: 'bad-token' });
    expect(await check(await token(signedIn, { alg: 'HS256' }))).toEqual({ open: false, reason: 'bad-token' });
  });

  it("stays closed for another team's token, an expired one, or one not valid yet", async () => {
    expect(await check(await token({ ...signedIn, iss: 'https://other.cloudflareaccess.com' }))).toEqual({ open: false, reason: 'bad-token' });
    expect(await check(await token({ ...signedIn, exp: NOW - 3600 }))).toEqual({ open: false, reason: 'bad-token' });
    expect(await check(await token({ ...signedIn, exp: undefined }))).toEqual({ open: false, reason: 'bad-token' });
    expect(await check(await token({ ...signedIn, nbf: NOW + 3600 }))).toEqual({ open: false, reason: 'bad-token' });
    // Within a minute either way is the two clocks differing, not an old token.
    expect(await check(await token({ ...signedIn, exp: NOW - 30, nbf: NOW + 30 }))).toEqual({ open: true });
  });

  it('stays closed for anything that is not a token', async () => {
    for (const t of ['abc', 'a.b.c', '...', 'a.b.c.d', '%%%.%%%.%%%']) {
      expect(await check(t)).toEqual({ open: false, reason: 'bad-token' });
    }
  });

  it("keeps Access's keys for an hour, and fetches them again for a key it hasn't seen", async () => {
    await check(await token(signedIn));
    await check(await token(signedIn));
    expect(fetched).toHaveLength(1);
    expect(await check(await token(signedIn, { kid: 'key-2' }))).toEqual({ open: false, reason: 'bad-token' });
    expect(fetched).toHaveLength(2);
    expect(await checkAccess(await token(signedIn), TEAM, { getKeys, now: NOW + 3601 })).toEqual({ open: true });
    expect(fetched).toHaveLength(3);
  });

  it("stays closed, and says to try again, when Access's keys can't be fetched", async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    expect(await checkAccess(await token(signedIn), TEAM, { getKeys: failing, now: NOW })).toEqual({ open: false, reason: 'no-keys' });
    const page = closedPage('no-keys');
    expect(page.status).toBe(503);
  });
});

describe('in front of every page and file (Cloudflare Pages middleware)', () => {
  const request = (t?: string) => new Request('https://ul-si-claims.pages.dev/', { headers: t ? { 'Cf-Access-Jwt-Assertion': t } : {} });
  const site = new Response('the website');
  const next = vi.fn(async () => site);

  beforeEach(() => {
    next.mockClear();
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(String(url));
      return Response.json({ keys: [publicKey] });
    });
  });

  it("sends the website only to a signed-in visitor, checked against the team's published keys", async () => {
    expect(await onRequest({ request: request(await token(signedIn)), env: { ACCESS_TEAM: TEAM }, next })).toBe(site);
    expect(next).toHaveBeenCalledOnce();
    expect(fetched).toEqual(['https://ul-si.cloudflareaccess.com/cdn-cgi/access/certs']);
  });

  it('sends a short closed page instead, never the website, and nothing from the request', async () => {
    const t = await token(signedIn);
    const [head, body, signature] = t.split('.') as [string, string, string];
    const forged = `${head}.${body}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    for (const [r, env] of [
      [request(), { ACCESS_TEAM: TEAM }],
      [request(t), {}],
      [request(forged), { ACCESS_TEAM: TEAM }],
    ] as const) {
      const page = await onRequest({ request: r, env, next });
      expect(page.status).toBe(403);
      expect(page.headers.get('Cache-Control')).toBe('no-store');
      const html = await page.text();
      expect(html).toContain('SI Claim Forms');
      expect(html).not.toContain(t.slice(0, 20));
    }
    expect(next).not.toHaveBeenCalled();
  });
});
