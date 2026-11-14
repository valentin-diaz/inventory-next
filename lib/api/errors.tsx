import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { PermissionDenied } from "@/components/permission-denied";

/** What a form built with useActionState shows after its Server Action fails. */
export type FormState<FieldName extends string> = {
  formError: string | null;
  fieldErrors: Partial<Record<FieldName, string>>;
};

const genericFormErrorMessage = "No se pudo guardar. Revisa los datos e intenta de nuevo.";

/**
 * For Server Components, after checking `!response.ok`.
 * Call it outside any try/catch: notFound() works by throwing, and a catch would swallow it.
 */
export function renderApiErrorForPage(response: Response): ReactElement {
  if (response.status === 404) notFound();
  if (response.status === 403) return <PermissionDenied />;
  throw new Error(`La API respondió ${response.status}.`);
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
