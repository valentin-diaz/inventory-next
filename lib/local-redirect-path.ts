/** Request header the proxy sets so a Server Component can tell which page it is rendering. */
export const currentPathRequestHeaderName = "x-current-path";

// Any origin works as a base: we only compare it with the origin the parser ends up with.
const parsingBaseOrigin = "http://local-redirect.invalid";

// Sending someone here after logging in would bounce them (/login) or log them out again (/salir).
const pathsThatAreNeverRedirectTargets = ["/login", "/salir"];

/**
 * Returns `candidate` if it is a path on this site, otherwise "/".
 * Parses with URL instead of checking prefixes: "/\malo.com" starts with "/" and not with "//",
 * but the URL parser reads it as "//malo.com", another site.
 */
export function toSafeLocalRedirectPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/")) return "/";

  let parsedCandidate: URL;
  try {
    parsedCandidate = new URL(candidate, parsingBaseOrigin);
  } catch {
    return "/";
  }
  if (parsedCandidate.origin !== parsingBaseOrigin) return "/";

  const pathnameWithoutTrailingSlash = parsedCandidate.pathname.replace(/\/+$/, "") || "/";
  if (pathsThatAreNeverRedirectTargets.includes(pathnameWithoutTrailingSlash)) return "/";

  return parsedCandidate.pathname + parsedCandidate.search + parsedCandidate.hash;
}
