import { logOut } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { roleNames, spanishNameOrCode } from "@/lib/labels";

// ############################################################################
// # PUBLIC API
// # Exported. The sidebar imports it: changing its props changes how the
// # sidebar uses it.
// ############################################################################

/**
 * The sidebar footer: the user's name (or email if they have none), their role in Spanish (or
 * "Sin rol asignado") and the "Cerrar sesión" button, a form that submits the `logOut` Server
 * Action. Takes no props.
 * Async Server Component: it reads the user, so render it inside <Suspense>.
 */
export async function UserMenu() {
  const user = await getCurrentUser();
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const roleName = user.role ? spanishNameOrCode(roleNames, user.role) : "Sin rol asignado";

  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      <div>
        <p className="truncate text-sm font-medium">{fullName}</p>
        <p className="text-xs text-muted-foreground">{roleName}</p>
      </div>
      <form action={logOut}>
        <Button type="submit" variant="outline" size="sm" className="w-full">
          Cerrar sesión
        </Button>
      </form>
    </div>
  );
}
