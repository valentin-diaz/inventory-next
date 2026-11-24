import "server-only";

// ############################################################################
// # PUBLIC API
// # Exported. Other files import these: renaming one, changing a parameter or
// # changing what a function returns breaks its callers.
// ############################################################################

export const accessTokenCookieName = "access";
export const refreshTokenCookieName = "refresh";

export type TokenPair = { access: string; refresh: string };

/**
 * Optimistic check: does this access token have enough life left to be used?
 * Returns true only for a readable JWT with more than `accessTokenRefreshMarginSeconds` left.
 * Returns false for undefined, unreadable or about-to-expire tokens: all of them mean "refresh".
 * Never checks the signature: Django does that on every API call.
 */
export function isAccessTokenFresh(accessToken: string | undefined): boolean {
  if (!accessToken) return false;
  const expiry = readTokenExpiry(accessToken);
  return expiry !== null && expiry - Date.now() / 1000 > accessTokenRefreshMarginSeconds;
}

/**
 * Stores both tokens as httpOnly cookies, each living as long as its token.
 * Takes `response.cookies` (proxy) or `await cookies()` (Server Function). Returns nothing.
 */
export function writeTokenCookies(cookieStore: WritableCookieStore, tokens: TokenPair): void {
  cookieStore.set(accessTokenCookieName, tokens.access, tokenCookieOptions(tokens.access));
  cookieStore.set(refreshTokenCookieName, tokens.refresh, tokenCookieOptions(tokens.refresh));
}

/** Deletes both cookies. Takes the same stores as `writeTokenCookies`. Returns nothing. */
export function deleteTokenCookies(cookieStore: WritableCookieStore): void {
  cookieStore.delete(accessTokenCookieName);
  cookieStore.delete(refreshTokenCookieName);
}

// ############################################################################
// # UTILITIES
// # Exported helpers that the public functions above are built on. Prefer the
// # public functions; changing one of these is safe once every importer is updated.
// ############################################################################

/** Refresh the access token when it has less than this left, so it can't expire mid-render. */
export const accessTokenRefreshMarginSeconds = 30;

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

/**
 * Returns the cookie options for one token.
 * The cookie lives exactly as long as its token, so the browser drops dead tokens by itself.
 */
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

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// # (They appear in the signatures above, but callers never need to name them.)
// ############################################################################

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
