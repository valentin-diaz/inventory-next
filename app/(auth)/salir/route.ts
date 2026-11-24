import { NextResponse, type NextRequest } from "next/server";

import { toSafeLocalRedirectPath } from "@/lib/local-redirect-path";
import { deleteTokenCookies } from "@/lib/session";

// ############################################################################
// # ENTRY POINT
// # Next.js calls `GET` when the browser requests /salir; no other file of ours
// # imports it. Nothing in this file is internal.
// ############################################################################

/**
 * Where a 401 found while rendering ends up: pages can't delete cookies, a Route Handler can.
 * Takes `?next=<path>` (the page to come back to after logging in again).
 * Returns a redirect to /login (with `next` only if it is a valid local path, see
 * `toSafeLocalRedirectPath`) that deletes both token cookies.
 */
export function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.nextUrl);
  const pathAfterLogin = toSafeLocalRedirectPath(request.nextUrl.searchParams.get("next"));
  if (pathAfterLogin !== "/") loginUrl.searchParams.set("next", pathAfterLogin);

  const response = NextResponse.redirect(loginUrl);
  deleteTokenCookies(response.cookies);
  return response;
}
