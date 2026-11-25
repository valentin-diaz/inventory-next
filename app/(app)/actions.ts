"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createApiClient } from "@/lib/api/client";
import { deleteTokenCookies, refreshTokenCookieName } from "@/lib/session";

// ############################################################################
// # BOUNDARY: "use server"
// # This file runs ONLY on the server. The browser can call what is exported
// # here (as a POST through Next.js). Everything exported from this file must
// # be an async function (types are fine).
// ############################################################################

// ############################################################################
// # ENTRY POINT
// # Called by the browser through <form action>, never by our own server code.
// ############################################################################

/**
 * Logs out: asks the API to blacklist the refresh token, deletes both cookies and redirects to
 * /login. Takes no arguments and does NOT return (redirect() throws on purpose).
 * A failure of the blacklist call is only logged: the cookies are deleted anyway.
 */
export async function logOut(): Promise<void> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(refreshTokenCookieName)?.value;

  if (refreshToken) {
    try {
      const { response } = await createApiClient().POST("/api/v1/auth/token/blacklist/", {
        body: { refresh: refreshToken },
      });
      if (!response.ok) {
        console.error(`La API respondió ${response.status} al anular el refresh token.`);
      }
    } catch (error) {
      console.error("No se pudo conectar con la API para anular el refresh token:", error);
    }
  }

  // Always, even if the blacklist call failed: on a shared computer, the next person must not
  // inherit this session.
  deleteTokenCookies(cookieStore);
  redirect("/login");
}
