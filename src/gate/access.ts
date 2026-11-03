// The sign-in check in front of the website, once it's online.
//
// Cloudflare Access asks each visitor for a code sent to their email and lets
// through only the administrators on the allow-list. It then adds a signed
// note (a token) to every request it lets through. This checks that note
// before Cloudflare sends any page or file, so if Access is ever switched off
// or set up wrongly, the site stays closed instead of open.
//
// The allow-list itself lives only in Cloudflare Access, where it's edited.
// Nothing here is logged, and the visitor's email isn't kept.

/** One of Cloudflare Access's public keys, as its certs address lists them. */
export interface AccessKey extends JsonWebKey {
  kid: string;
}

export type ClosedReason = 'not-set-up' | 'no-token' | 'bad-token' | 'no-keys';
export type Verdict = { open: true } | { open: false; reason: ClosedReason };

/** Fetches the team's public keys; replaced in the tests. */
export type GetKeys = (address: string) => Promise<AccessKey[]>;

/** Allowed difference between Cloudflare's clock and this one, in seconds. */
const LEEWAY = 60;
/** How long fetched keys are used before fetching again, in seconds. Access changes keys about every 6 weeks. */
const KEEP_KEYS = 3600;

/**
 * The team's sign-in address, from the ACCESS_TEAM setting. Takes the team
 * name ("ul-si"), its domain ("ul-si.cloudflareaccess.com") or the full
 * address. Anything else gives null, so the site stays closed.
 */
export function teamAddress(team: string | undefined): string | null {
  const name = team
    ?.trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '')
    .replace(/\.cloudflareaccess\.com$/, '');
  return name && /^[a-z0-9-]+$/.test(name) ? `https://${name}.cloudflareaccess.com` : null;
}

async function fetchKeys(address: string): Promise<AccessKey[]> {
  const response = await fetch(`${address}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access keys: ${response.status}`);
  return ((await response.json()) as { keys?: AccessKey[] }).keys ?? [];
}

const keptKeys = new Map<string, { keys: AccessKey[]; until: number }>();

/** Forgets the fetched keys (for the tests). */
export function forgetKeys() {
  keptKeys.clear();
}

/** The key a token names: from the kept copy, else fetched again (a new key appears when Access changes keys). */
async function keyFor(address: string, kid: string, getKeys: GetKeys, now: number): Promise<AccessKey | undefined> {
  const kept = keptKeys.get(address);
  const key = kept && kept.until > now ? kept.keys.find((k) => k.kid === kid) : undefined;
  if (key) return key;
  const keys = await getKeys(address);
  keptKeys.set(address, { keys, until: now + KEEP_KEYS });
  return keys.find((k) => k.kid === kid);
}

function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

function json<T>(base64url: string): T {
  return JSON.parse(new TextDecoder().decode(bytes(base64url))) as T;
}

/**
 * Whether a request may go through: its Access token must be signed by the
 * team's Access keys (RS256), issued by the team, and not expired.
 */
export async function checkAccess(
  token: string | null,
  team: string | undefined,
  options: { getKeys?: GetKeys; now?: number } = {},
): Promise<Verdict> {
  const address = teamAddress(team);
  if (!address) return { open: false, reason: 'not-set-up' };
  if (!token) return { open: false, reason: 'no-token' };
  const bad: Verdict = { open: false, reason: 'bad-token' };
  const now = options.now ?? Math.floor(Date.now() / 1000);

  let head: string, body: string, signature: Uint8Array<ArrayBuffer>;
  let header: { alg?: string; kid?: string }, claims: { iss?: string; exp?: number; nbf?: number };
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return bad;
    [head, body] = parts as [string, string, string];
    signature = bytes(parts[2]!);
    header = json(head);
    claims = json(body);
  } catch {
    return bad;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return bad;

  let jwk: AccessKey | undefined;
  try {
    jwk = await keyFor(address, header.kid, options.getKeys ?? fetchKeys, now);
  } catch {
    return { open: false, reason: 'no-keys' };
  }
  if (!jwk) return bad;

  try {
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    if (!(await crypto.subtle.verify(algorithm, key, signature, new TextEncoder().encode(`${head}.${body}`)))) return bad;
  } catch {
    return bad;
  }
  if (claims.iss !== address) return bad;
  if (typeof claims.exp !== 'number' || claims.exp < now - LEEWAY) return bad;
  if (typeof claims.nbf === 'number' && claims.nbf > now + LEEWAY) return bad;
  return { open: true };
}

const CLOSED: Record<ClosedReason, string> = {
  'not-set-up': "This site's sign-in isn't finished yet, so it stays closed. (The ACCESS_TEAM setting is missing or not a team name.)",
  'no-token': 'This site is for SI administrators only.',
  'bad-token': "Your sign-in couldn't be checked. Close this page and open the site again to sign in.",
  'no-keys': "The sign-in couldn't be checked just now. Try again in a minute.",
};

/** The page shown instead of the site. */
export function closedPage(reason: ClosedReason): Response {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SI Claim Forms</title><h1>SI Claim Forms</h1><p>${CLOSED[reason]}</p></html>`;
  return new Response(html, {
    status: reason === 'no-keys' ? 503 : 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** What Cloudflare Pages hands its middleware (only the parts used here). */
export interface PagesContext {
  request: Request;
  env: { ACCESS_TEAM?: string };
  next: () => Promise<Response>;
}

/** Runs before every page and file of the website (functions/_middleware.ts). */
export async function onRequest({ request, env, next }: PagesContext): Promise<Response> {
  const verdict = await checkAccess(request.headers.get('Cf-Access-Jwt-Assertion'), env.ACCESS_TEAM);
  return verdict.open ? next() : closedPage(verdict.reason);
}
