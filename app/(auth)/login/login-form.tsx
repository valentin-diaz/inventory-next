"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { logInWithEmailAndPassword, type LoginFormState } from "./actions";

// ############################################################################
// # BOUNDARY: "use client"
// # This file ships to the browser. Props, state and anything imported here are
// # visible to the user: no secrets, no server-only modules.
// ############################################################################

// ############################################################################
// # PUBLIC API
// # Exported. page.tsx imports it: changing its props changes how the page uses it.
// ############################################################################

/**
 * The login form. Takes no props; reads `?next=` from the URL (so it must render inside
 * <Suspense>) and shows the error message the Server Action returns.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState(
    logInWithEmailAndPassword,
    initialLoginFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* Validated again on the server: never trust what the browser sends. */}
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// ############################################################################

const initialLoginFormState: LoginFormState = { message: null, email: "" };
