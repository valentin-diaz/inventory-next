import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

// ############################################################################
// # ENTRY POINT
// # Next.js reads these two exports by convention for the /login route; no other
// # file of ours imports them. Nothing in this file is internal.
// ############################################################################

/** Tab title for /login. Read by Next.js. */
export const metadata: Metadata = { title: "Iniciar sesión" };

/** The /login page. Takes no props and returns the page's JSX. */
export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
          <CardDescription>Simulador de Cadena de Tiendas</CardDescription>
        </CardHeader>
        <CardContent>
          {/* LoginForm reads the URL (?next=), which is request data: it streams in. */}
          <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
