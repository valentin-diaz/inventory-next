import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";

import { PermissionDenied } from "@/components/permission-denied";
import { currentPathRequestHeaderName } from "@/lib/local-redirect-path";

// ############################################################################
// # PUBLIC API
// # Exported. Pages and Server Actions import these: renaming one, changing a
// # parameter or changing what a function returns breaks its callers.
// ############################################################################

/** What a form built with useActionState shows after its Server Action fails. */
export type FormState<FieldName extends string> = {
  formError: string | null;
  fieldErrors: Partial<Record<FieldName, string>>;
};

/**
 * For Server Components, after checking `!response.ok`:
 * `if (!response.ok) return await renderApiErrorForPage(response);`
 * Call it outside any try/catch: notFound() and redirect() work by throwing, and a catch would
 * swallow them.
 * Returns <PermissionDenied /> for a 403. It never returns for the rest: a 401 redirects through
 * /salir, a 404 calls notFound(), and any other status throws an Error.
 */
export async function renderApiErrorForPage(response: Response): Promise<ReactElement> {
  if (response.status === 401) await redirectToEndExpiredSession();
  if (response.status === 404) notFound();
  if (response.status === 403) return <PermissionDenied />;
  throw new Error(`La API respondió ${response.status}.`);
}

/**
 * The API rejected the token while rendering: send the user through /salir, which deletes the
 * cookies, and back to this page after logging in again.
 * Never returns: it redirects, so call it outside any try/catch.
 */
export async function redirectToEndExpiredSession(): Promise<never> {
  const currentPath = (await headers()).get(currentPathRequestHeaderName) ?? "/";
  redirect(`/salir?next=${encodeURIComponent(currentPath)}`);
}

/**
 * For Server Actions: turns a DRF error body into the state the form shows.
 * Errors for fields the form doesn't display go to formError, so none is lost.
 */
export function formStateFromApiError<FieldName extends string>(
  errorBody: unknown,
  displayedFieldNames: readonly FieldName[],
): FormState<FieldName> {
  const formLevelMessages: string[] = [];
  const fieldErrors: Partial<Record<FieldName, string>> = {};

  if (isPlainObject(errorBody)) {
    for (const [key, value] of Object.entries(errorBody)) {
      const message = joinErrorMessages(value);
      if (message === null) continue;

      if (key === "detail" || key === "non_field_errors") {
        formLevelMessages.push(message);
      } else if (isDisplayedFieldName(key, displayedFieldNames)) {
        fieldErrors[key] = message;
      } else {
        formLevelMessages.push(`${key}: ${message}`);
      }
    }
  }

  if (formLevelMessages.length === 0 && Object.keys(fieldErrors).length === 0) {
    return { formError: genericFormErrorMessage, fieldErrors };
  }
  return {
    formError: formLevelMessages.length > 0 ? formLevelMessages.join(" ") : null,
    fieldErrors,
  };
}

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// ############################################################################

const genericFormErrorMessage = "No se pudo guardar. Revisa los datos e intenta de nuevo.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// DRF sends a list of strings from validation (is_valid) and a plain string from create()/save().
function joinErrorMessages(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const messages = value.filter((item): item is string => typeof item === "string");
    return messages.length > 0 ? messages.join(" ") : null;
  }
  return null;
}

function isDisplayedFieldName<FieldName extends string>(
  key: string,
  displayedFieldNames: readonly FieldName[],
): key is FieldName {
  return (displayedFieldNames as readonly string[]).includes(key);
}
