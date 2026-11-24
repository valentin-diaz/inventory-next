import { NextResponse, type NextRequest } from "next/server";

import { createApiClient } from "@/lib/api/client";
import { currentPathRequestHeaderName } from "@/lib/local-redirect-path";
import {
  accessTokenCookieName,
  deleteTokenCookies,
  isAccessTokenFresh,
  refreshTokenCookieName,
  writeTokenCookies,
  type TokenPair,
} from "@/lib/session";

// ############################################################################
// # ENTRY POINT
// # Called by Next.js before every matched request, never by our own code.
// # The names `proxy` and `config` and the shapes below are fixed by Next.js.
// ############################################################################

/**
 * Runs before any page, layout or Server Action. Takes the incoming request and returns a
 * NextResponse, one of:
 *  - a redirect to /login?next=<path>  (GET, no session, outside /login and /salir);
 *  - a redirect to /                   (GET /login with a session);
 *  - next(): the request continues, carrying the (maybe refreshed) cookies and the
 *    `x-current-path` header for the render.
 * Cookies changed by a refresh are written on the request (this render reads them) and on the
 * response (the browser keeps them).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // /salir deletes the cookies itself: refreshing first would only rotate a token it's dropping.
  if (pathname === "/salir") return NextResponse.next();

  let accessToken = request.cookies.get(accessTokenCookieName)?.value;
  const refreshToken = request.cookies.get(refreshTokenCookieName)?.value;
  let refreshedTokens: TokenPair | null = null;
  let isRefreshTokenRejected = false;

  // Missing, about to expire, or unreadable (a garbage cookie): all mean "refresh".
  if (!isAccessTokenFresh(accessToken) && refreshToken) {
    const refreshResult = await refreshTokensSharingConcurrentRequests(refreshToken);
    if (refreshResult.outcome === "refreshed") {
      refreshedTokens = refreshResult.tokens;
      accessToken = refreshResult.tokens.access;
    } else if (refreshResult.outcome === "rejected") {
      isRefreshTokenRejected = true;
      accessToken = undefined;
    }
  }

  const hasSession =
    isAccessTokenFresh(accessToken) || (Boolean(refreshToken) && !isRefreshTokenRejected);

  // Only navigations are redirected. A Server Action is a POST to the page's route, and a 307
  // would make the browser repeat that POST against /login. The action finds out on its own:
  // the API answers 401.
  const isNavigation = request.method === "GET";
  if (isNavigation && !hasSession && !pathsReachableWithoutSession.includes(pathname)) {
    const loginUrl = new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("next", pathname + search);
    return withTokenCookieChanges(
      NextResponse.redirect(loginUrl),
      refreshedTokens,
      isRefreshTokenRejected,
    );
  }
  if (isNavigation && hasSession && pathname === "/login") {
    return withTokenCookieChanges(
      NextResponse.redirect(new URL("/", request.nextUrl)),
      refreshedTokens,
      isRefreshTokenRejected,
    );
  }

  // On the request: so cookies() in this very render reads the new tokens.
  if (refreshedTokens) {
    request.cookies.set(accessTokenCookieName, refreshedTokens.access);
    request.cookies.set(refreshTokenCookieName, refreshedTokens.refresh);
  } else if (isRefreshTokenRejected) {
    request.cookies.delete(accessTokenCookieName);
    request.cookies.delete(refreshTokenCookieName);
  }
  const forwardedRequestHeaders = new Headers(request.headers);
  // set, not append: overwrites anything the browser sent under the same name.
  forwardedRequestHeaders.set(currentPathRequestHeaderName, pathname + search);

  // On the response: so the browser keeps them for the next request.
  return withTokenCookieChanges(
    NextResponse.next({ request: { headers: forwardedRequestHeaders } }),
    refreshedTokens,
    isRefreshTokenRejected,
  );
}

/** Which requests run the proxy: everything except static assets and images. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// ############################################################################

type TokenRefreshResult =
  | { outcome: "refreshed"; tokens: TokenPair }
  // 401: the refresh token expired, was blacklisted, or the user was deactivated.
  | { outcome: "rejected" }
  // Network error or any other status: the API didn't answer, the session may still be fine.
  | { outcome: "unavailable" };

const pathsReachableWithoutSession = ["/login", "/salir"];

// ---- Building the response ------------------------------------------------

/** Writes the new tokens, or deletes both cookies if the refresh was rejected, on `response`. */
function withTokenCookieChanges(
  response: NextResponse,
  refreshedTokens: TokenPair | null,
  isRefreshTokenRejected: boolean,
): NextResponse {
  if (refreshedTokens) writeTokenCookies(response.cookies, refreshedTokens);
  else if (isRefreshTokenRejected) deleteTokenCookies(response.cookies);
  return response;
}

// ---- Refreshing tokens (shared between concurrent requests) ---------------

// Requests that arrive together with the same refresh token (a navigation plus the prefetches
// of its links) share one refresh. Otherwise the first would rotate the token and the rest
// would get 401 for reusing it, logging the user out at random.
// Module state works only because one Node.js process serves the whole app (see below).
const tokenRefreshesByRefreshToken = new Map<string, Promise<TokenRefreshResult>>();
const settledRefreshRetentionMilliseconds = 30_000;

/** Returns the refresh already in flight (or just finished) for this token, or starts one. */
function refreshTokensSharingConcurrentRequests(refreshToken: string): Promise<TokenRefreshResult> {
  const refreshAlreadyStarted = tokenRefreshesByRefreshToken.get(refreshToken);
  if (refreshAlreadyStarted) return refreshAlreadyStarted;

  const refresh = requestTokenRefreshFromApi(refreshToken);
  tokenRefreshesByRefreshToken.set(refreshToken, refresh);
  void refresh.then((result) => {
    if (result.outcome === "unavailable") {
      // Don't keep a failure: the next request should try again, not reuse the error.
      tokenRefreshesByRefreshToken.delete(refreshToken);
    } else {
      // Keep it a little: requests that arrive just after the refresh reuse its result.
      setTimeout(
        () => tokenRefreshesByRefreshToken.delete(refreshToken),
        settledRefreshRetentionMilliseconds,
      );
    }
  });
  return refresh;
}

/** Calls the API once. Never throws: turns the response, or the failure, into a result. */
async function requestTokenRefreshFromApi(refreshToken: string): Promise<TokenRefreshResult> {
  try {
    const { data: tokens, response } = await createApiClient().POST("/api/v1/auth/token/refresh/", {
      body: { refresh: refreshToken },
    });
    if (tokens) return { outcome: "refreshed", tokens: { access: tokens.access, refresh: tokens.refresh } };
    if (response.status === 401) return { outcome: "rejected" };
    console.error(`La API respondió ${response.status} al refrescar el token.`);
    return { outcome: "unavailable" };
  } catch (error) {
    console.error("No se pudo conectar con la API para refrescar el token:", error);
    return { outcome: "unavailable" };
  }
}
