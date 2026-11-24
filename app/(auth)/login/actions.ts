"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createApiClient } from "@/lib/api/client";
import { toSafeLocalRedirectPath } from "@/lib/local-redirect-path";
import { writeTokenCookies } from "@/lib/session";

// ############################################################################
// # BOUNDARY: "use server"
// # This file runs ONLY on the server. The browser can call what is exported
// # here (as a POST through Next.js), and whatever is returned travels back to
// # the browser. Everything exported from this file must be an async function
// # (types are fine).
// ############################################################################

// ############################################################################
// # PUBLIC API
// # Shared with login-form.tsx. Changing it changes what the form receives.
// ############################################################################

/** Everything in here reaches the browser: never put the password or the tokens in it. */
export type LoginFormState = { message: string | null; email: string };

// ############################################################################
// # ENTRY POINT
// # Called by the browser through <form action>, never by our own server code.
// ############################################################################

/**
 * Logs in with email and password.
 * Returns a LoginFormState (error message + the email typed) when the login fails.
 * On success it does NOT return: it writes the two token cookies and redirects to the safe
 * `next` path, or to "/".
 */
export async function logInWithEmailAndPassword(
  previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const pathAfterLogin = toSafeLocalRedirectPath(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return { message: "Escribe tu email y tu contraseña.", email };
  }

  // The try wraps only the call that can fail on the network. redirect() below throws on
  // purpose; inside the try, the catch would swallow it and show a false "can't connect".
  let tokenResult;
  try {
    tokenResult = await createApiClient().POST("/api/v1/auth/token/", { body: { email, password } });
  } catch (error) {
    console.error("No se pudo conectar con la API:", error);
    return { message: "No se pudo conectar con la API.", email };
  }

  const { data: tokens, response } = tokenResult;
  if (response.status === 401) {
    // Also what a deactivated account gets: the API doesn't tell them apart, and neither do we.
    return { message: "El email o la contraseña no son correctos.", email };
  }
  if (response.status === 429) {
    return { message: "Demasiados intentos. Espera un minuto e intenta de nuevo.", email };
  }
  if (!tokens) {
    console.error(`La API respondió ${response.status} al iniciar sesión.`);
    return { message: "No se pudo iniciar sesión. Intenta de nuevo.", email };
  }

  writeTokenCookies(await cookies(), tokens);
  redirect(pathAfterLogin);
}
