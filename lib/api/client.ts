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
