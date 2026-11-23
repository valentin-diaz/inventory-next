import "server-only";

export const accessTokenCookieName = "access";
export const refreshTokenCookieName = "refresh";

/** Refresh the access token when it has less than this left, so it can't expire mid-render. */
export const accessTokenRefreshMarginSeconds = 30;

export type TokenPair = { access: string; refresh: string };

type TokenCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

/** What both `response.cookies` (proxy) and `await cookies()` (Server Function) offer. */
type WritableCookieStore = {
  set(name: string, value: string, options: TokenCookieOptions): unknown;
  delete(name: string): unknown;
};

/**
 * Reads `exp` (seconds since the epoch) from a JWT payload WITHOUT checking its signature.
 * Only good for deciding when to refresh: Django checks the signature on every API call.
 * Returns null for anything that isn't a readable JWT, so a garbage cookie can't crash the proxy.
 */
export function readTokenExpiry(token: string): number | null {
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    if (typeof payload === "object" && payload !== null && "exp" in payload) {
      return typeof payload.exp === "number" ? payload.exp : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isAccessTokenFresh(accessToken: string | undefined): boolean {
  if (!accessToken) return false;
  const expiry = readTokenExpiry(accessToken);
  return expiry !== null && expiry - Date.now() / 1000 > accessTokenRefreshMarginSeconds;
}

/** The cookie lives exactly as long as its token, so the browser drops dead tokens by itself. */
export function tokenCookieOptions(token: string): TokenCookieOptions {
  const expiry = readTokenExpiry(token);
  const secondsUntilExpiry = expiry === null ? 0 : Math.max(0, Math.floor(expiry - Date.now() / 1000));
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: secondsUntilExpiry,
  };
}

export function writeTokenCookies(cookieStore: WritableCookieStore, tokens: TokenPair): void {
  cookieStore.set(accessTokenCookieName, tokens.access, tokenCookieOptions(tokens.access));
  cookieStore.set(refreshTokenCookieName, tokens.refresh, tokenCookieOptions(tokens.refresh));
}

export function deleteTokenCookies(cookieStore: WritableCookieStore): void {
  cookieStore.delete(accessTokenCookieName);
  cookieStore.delete(refreshTokenCookieName);
}
