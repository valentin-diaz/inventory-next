import { Suspense } from "react";

import { AppNavigation } from "@/components/app-navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/user-menu";

// ############################################################################
// # PUBLIC API
// # Exported. The shell layout imports it: changing its props changes how the
// # layout uses it.
// ############################################################################

/**
 * The sidebar frame: the app title (static) and, behind their own <Suspense>, the navigation and
 * the user menu, which need the signed-in user. Takes no props.
 * It is a Server Component, so the frame prerenders and the user parts stream in.
 */
export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <span className="px-2 py-1 font-semibold">Simulador de Cadena de Tiendas</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <Suspense fallback={<Skeleton className="h-8 w-full" />}>
              <AppNavigation />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
          <UserMenu />
        </Suspense>
      </SidebarFooter>
    </Sidebar>
  );
}
