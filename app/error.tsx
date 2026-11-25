"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// ############################################################################
// # BOUNDARY: "use client"
// # This file ships to the browser. Never show `error.message` to the user: it
// # may carry internal details.
// ############################################################################

// ############################################################################
// # ENTRY POINT
// # Next.js renders this when a page or layout below `app/` throws, including the
// # `(app)` layout; no file of ours imports it.
// ############################################################################

/**
 * The error page. Takes `error` (whatever was thrown) and `retry` (re-fetches and re-renders the
 * content that failed), logs the error and returns a fixed message with a "Reintentar" button.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>No se pudo cargar esta página.</CardTitle>
          <CardDescription>Puede que la API no esté disponible.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => retry()}>Reintentar</Button>
        </CardContent>
      </Card>
    </main>
  );
}
