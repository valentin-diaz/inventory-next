import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";

// ############################################################################
// # ENTRY POINT
// # Next.js reads these two exports by convention for the `/` route; no other
// # file of ours imports them.
// ############################################################################

/** Tab title for `/`. Read by Next.js. */
export const metadata: Metadata = { title: "Inicio" };

/**
 * The home page. The title is static; the greeting needs the user, so it streams in behind
 * <Suspense>. Takes no props and returns the page's JSX.
 */
// Every role lands here in Phase 1. Phase 2 sends sellers to their store.
export default function HomePage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Inicio</h1>
      <Suspense fallback={<Skeleton className="h-24 w-full max-w-md" />}>
        <HomeGreeting />
      </Suspense>
    </main>
  );
}

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// ############################################################################

async function HomeGreeting() {
  // Same render pass as AppNavigation and UserMenu: cache() makes it one /auth/me/ call.
  const user = await getCurrentUser();
  const firstNameOrEmail = user.first_name || user.email;

  if (user.stores.length === 0) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Hola, {firstNameOrEmail}</CardTitle>
          <CardDescription>
            Tu cuenta no tiene tiendas asignadas. Pídele a tu encargado que te asigne una.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return <p>Hola, {firstNameOrEmail}. Las pantallas de tus tiendas llegan en las próximas fases.</p>;
}
