import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// ############################################################################
// # ENTRY POINT
// # Next.js renders this for any URL no route matches and for every notFound()
// # without a closer not-found page; no file of ours imports it. It renders
// # outside the `(app)` shell.
// ############################################################################

/** The 404 page. Takes no props and returns a message with a link to Inicio. */
export default function NotFoundPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>No encontramos esta página</CardTitle>
          <CardDescription>Puede que el enlace esté mal escrito o que la página ya no exista.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/">Ir a Inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
