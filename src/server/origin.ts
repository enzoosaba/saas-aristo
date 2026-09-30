export function allowedRequestOrigins(requestUrl: string) {
  const origins = new Set<string>();
  const add = (value: string | undefined, addProtocol = false) => {
    if (!value) return;
    try {
      origins.add(new URL(addProtocol ? `https://${value}` : value).origin);
    } catch {
      // Invalid deployment configuration must not make origin checks permissive.
    }
  };
  add(process.env.APP_ORIGIN);
  if (process.env.VERCEL === "1") {
    // Both values are injected by Vercel, not supplied by the HTTP client.
    add(process.env.VERCEL_URL, true);
    add(process.env.VERCEL_BRANCH_URL, true);
  }
  if (!origins.size) add(requestUrl);
  return origins;
}
