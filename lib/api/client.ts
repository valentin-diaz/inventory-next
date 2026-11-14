import "server-only";

import createClient from "openapi-fetch";

import type { paths } from "./schema";

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
