import "server-only";

import { cookies } from "next/headers";
import createClient from "openapi-fetch";

import { accessTokenCookieName } from "@/lib/session";

import type { paths } from "./schema";

// ############################################################################
// # PUBLIC API
// # Exported. Pages, Server Actions and the proxy import these: renaming one,
// # changing a parameter or changing what a function returns breaks its callers.
// ############################################################################

/**
 * Creates a typed client for the Inventario API.
 *
 * Call it once per request and pass that request's access token (Phase 1).
 * Never keep a token at module level: module scope is shared by every request.
 */
export function createApiClient(accessToken?: string) {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new Error("Falta la variable de entorno API_URL. Copia .env.example a .env.local.");
  }
  if (!URL.canParse(apiUrl)) {
    throw new Error(`API_URL no es una URL válida: "${apiUrl}".`);
  }

  return createClient<paths>({
    baseUrl: apiUrl,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    fetch: fetchWithContentLength,
  });
}

/**
 * The client for whoever made this request, with the access token from their cookie.
 * The proxy has already refreshed it, so this is the token the API should accept.
 * Returns the same typed client as `createApiClient`; without the cookie it sends no token and
 * the API answers 401. Reads cookies, so call it inside <Suspense> (or in a Server Function).
 */
export async function createApiClientForCurrentRequest() {
  const cookieStore = await cookies();
  return createApiClient(cookieStore.get(accessTokenCookieName)?.value);
}

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses it: change freely.
// ############################################################################

/**
 * `fetch` for openapi-fetch: sends a request that has a body with `Content-Length`.
 *
 * openapi-fetch calls fetch with a `Request`, and Next.js's patched fetch rebuilds it from its
 * body stream, so it can go out as `Transfer-Encoding: chunked`. Django reads a body without
 * `Content-Length` as empty and answers 400. Reading the body first and passing the URL and the
 * bytes keeps its length known. Requests without a body go through unchanged.
 */
async function fetchWithContentLength(request: Request): Promise<Response> {
  if (!request.body) return fetch(request);

  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: await request.arrayBuffer(),
    redirect: request.redirect,
    signal: request.signal,
  });
}
