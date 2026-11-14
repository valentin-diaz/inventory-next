import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PermissionDenied() {
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>No tienes permiso</CardTitle>
        <CardDescription>Tu cuenta no tiene acceso a esta información.</CardDescription>
      </CardHeader>
    </Card>
  );
}
