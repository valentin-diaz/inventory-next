import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribeToViewportChanges(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// useSyncExternalStore instead of useState + useEffect: the shadcn version called setState
// inside an effect, which the project's lint rule (react-hooks/set-state-in-effect) rejects.
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToViewportChanges,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false // no window on the server: render the desktop layout
  )
}
