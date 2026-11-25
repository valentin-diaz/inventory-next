import { Skeleton } from "@/components/ui/skeleton";

// ############################################################################
// # ENTRY POINT
// # Next.js shows this while a page inside `(app)` is still loading, inside the
// # shell; no file of ours imports it.
// ############################################################################

/** The loading placeholder for the content area. Takes no props and returns skeletons. */
export default function AppPageLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full max-w-md" />
    </div>
  );
}
