import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

// ############################################################################
// # ENTRY POINT
// # Next.js renders this layout around every page inside `(app)`; no other file
// # of ours imports it. `/login` lives in `(auth)`, so it never gets the shell.
// ############################################################################

/**
 * The shell: sidebar, a header with the sidebar toggle, and the page (`children`) next to them.
 * Takes the page as `children` and returns the layout's JSX.
 */
// No await here: reading the session at the top of a layout fails the build with Cache
// Components. What depends on the user streams in behind <Suspense> inside AppSidebar.
export default function AppShellLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
