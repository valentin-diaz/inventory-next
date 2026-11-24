import type { Route } from "next";
import Link from "next/link";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { can, getCurrentUser } from "@/lib/auth";

// ############################################################################
// # PUBLIC API
// # Exported. The sidebar imports it: changing its props changes how the
// # sidebar uses it.
// ############################################################################

/**
 * The sidebar menu with only the pages the signed-in user can see (`can()`). Takes no props.
 * Async Server Component: it reads the user, so render it inside <Suspense>.
 */
export async function AppNavigation() {
  const user = await getCurrentUser();
  const visibleNavigationItems = navigationItems.filter(
    (item) => item.requiredPermission === null || can(user, item.requiredPermission),
  );

  return (
    <SidebarMenu>
      {visibleNavigationItems.map((item) => (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton asChild>
            <Link href={item.href}>{item.label}</Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

// ############################################################################
// # INTERNAL
// # Not exported. Only this file uses them: change freely.
// ############################################################################

type NavigationItem = {
  href: Route;
  label: string;
  /** null: everyone who is signed in sees it. */
  requiredPermission: string | null;
};

// Each phase adds its pages here, with the permission that unlocks them.
const navigationItems: NavigationItem[] = [{ href: "/", label: "Inicio", requiredPermission: null }];
