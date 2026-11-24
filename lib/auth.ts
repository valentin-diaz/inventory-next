import "server-only";

import { cache } from "react";

import { createApiClientForCurrentRequest } from "@/lib/api/client";
import { redirectToEndExpiredSession } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

// ############################################################################
// # PUBLIC API
// # Exported. Pages, layouts and components import these: renaming one,
// # changing a parameter or changing what a function returns breaks its callers.
// ############################################################################

/** Only what the UI uses: nothing else from /auth/me/ reaches components. */
export type CurrentUser = Pick<
  User,
  "id" | "email" | "first_name" | "last_name" | "role" | "permissions" | "stores"
>;

/**
 * The signed-in user, from the API (GET /auth/me/). Wrapped in cache(): the layout, the navigation
 * and the page share one /auth/me/ call per render. In a Server Action cache() does nothing, so
 * call it once there and reuse the result.
 * Returns a CurrentUser. It does not return when the API answers 401 (it redirects through
 * /salir) and it throws for any other failure. Reads cookies, so call it inside <Suspense>.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const api = await createApiClientForCurrentRequest();
  const { data: user, response } = await api.GET("/api/v1/auth/me/");
  if (response.status === 401) await redirectToEndExpiredSession();
  if (!user) throw new Error(`La API respondió ${response.status} en /auth/me/.`);

  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    permissions: user.permissions,
    stores: user.stores,
  };
});

/**
 * Returns true if `permission` is in `user.permissions`.
 * Optimistic: decides what to show. The API still authorizes every call.
 */
export function can(user: CurrentUser, permission: string): boolean {
  return user.permissions.includes(permission);
}

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// ############################################################################

type User = components["schemas"]["User"];
