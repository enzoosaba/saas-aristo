// Who is rate-limited, and how, on the anonymous auth endpoints. Pure functions
// (no imports) so tests/rate-limit.test.mjs can load them.
//
// The old policy had one bucket shared by everybody ("auth-global", 100 per 15
// minutes) plus one per e-mail address: any script sending 100 requests in 15
// minutes locked every login and sign-up for everyone, and 10 wrong tries against
// an e-mail locked that account's real owner out. The buckets below are keyed so
// that whoever misbehaves mostly exhausts their own budget.

const WINDOW = 15 * 60_000;
export type Bucket = { key: string; max: number; window: number };

// The client IP, only when it can be trusted. On Vercel the platform sets
// x-vercel-forwarded-for / x-real-ip / x-forwarded-for itself, so a client cannot
// choose them. Anywhere else (Docker, local) those headers are whatever the client
// sent, so trusting them would let an attacker pick a fresh bucket per request:
// there the answer is "unknown" and the shared fallback buckets apply.
export function clientIp(
  headers: { get(name: string): string | null },
  trustProxyHeaders: boolean = Boolean(process.env.VERCEL),
): string | null {
  if (!trustProxyHeaders) return null;
  const raw =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    "";
  const ip = raw.trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip.toLowerCase() : null;
}

export function authBuckets(email: string, ip: string | null): Bucket[] {
  return [
    // one address cannot flood the endpoint; without a trusted IP, a generous
    // shared ceiling still bounds the scrypt work
    ip
      ? { key: `auth-ip:${ip}`, max: 40, window: WINDOW }
      : { key: "auth-global", max: 1000, window: WINDOW },
    // guesses against one account from one address
    { key: `auth:${email}:${ip ?? "-"}`, max: 10, window: WINDOW },
    // guesses against one account from many addresses (higher: it also affects
    // the real owner, so it must cost an attacker several addresses to reach it)
    { key: `auth:${email}`, max: 60, window: WINDOW },
  ];
}

export function recoveryIpBucket(ip: string | null): Bucket {
  return ip
    ? { key: `recovery-ip:${ip}`, max: 20, window: WINDOW }
    : { key: "recovery-global", max: 200, window: WINDOW };
}

export function recoveryEmailBuckets(email: string, ip: string | null): Bucket[] {
  return [
    { key: `recovery:${email}:${ip ?? "-"}`, max: 3, window: WINDOW },
    { key: `recovery:${email}`, max: 10, window: WINDOW },
  ];
}
