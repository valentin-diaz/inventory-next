# Inventario frontend

Spanish-language web app for the store chain run by the [Inventario API](../../inventario).
Built with Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4 and shadcn/ui.
The browser only talks to Next.js; only Next.js talks to the API.

## Requirements

- Node.js 20.9 or later
- The Inventario API running at `http://localhost:8000` (see its README)

## Getting started

```bash
# 1. Start the API first (in ../../inventario)
uv run python manage.py runserver

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local

# 4. Run the development server
npm run dev
```

Open http://localhost:3000 and sign in. The API's `manage.py seed` creates a demo account for each role (see "Demo data" in its README).

## Environment variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `API_URL` | `http://localhost:8000` | Base URL of the API. Server-only: it has no `NEXT_PUBLIC_` prefix, so it never reaches the browser. |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000. |
| `npm run build` | Production build. It also type-checks, and fails on request-time data outside `<Suspense>`. |
| `npm start` | Serves the production build. |
| `npm run lint` | ESLint. |
| `npm run api:types` | Regenerates `lib/api/schema.d.ts` from the API's OpenAPI schema. Run it with the API up whenever the API changes, and commit the result. |

## Where each Next.js concept lives

| Concept | Where to look |
| --- | --- |
| Server Component fetching data, streamed behind `<Suspense>` (Cache Components) | `HomeGreeting` in `app/(app)/page.tsx` |
| Root layout, `metadata` with `title.template`, `lang` | `app/layout.tsx` |
| Client Component rendered from a Server layout | `<Toaster />` in `app/layout.tsx`, `components/ui/sonner.tsx` |
| Server-only environment variables (no `NEXT_PUBLIC_`), `import "server-only"` | `lib/api/client.ts`, `.env.example` |
| Typed API client generated from OpenAPI | `lib/api/schema.d.ts`, `lib/api/client.ts` |
| `notFound()`; expected errors rendered, unexpected errors thrown | `renderApiErrorForPage` in `lib/api/errors.tsx` |
| Errors as return values for `useActionState` forms | `formStateFromApiError` in `lib/api/errors.tsx` |
| Proxy: refreshing tokens, writing cookies on the request and the response, redirects | `proxy.ts` |
| Route groups: pages with and without the shell | `app/(auth)/`, `app/(app)/` |
| Server Action that sets cookies and redirects; `useActionState` form | `app/(auth)/login/actions.ts`, `app/(auth)/login/login-form.tsx` |
| Server Action that deletes cookies (and invalidates the Client Cache) | `logOut` in `app/(app)/actions.ts` |
| Route Handler that deletes cookies (pages can't) | `app/(auth)/salir/route.ts` |
| Data Access Layer with React `cache()` | `lib/auth.ts` |
| Passing data from Proxy to Server Components through a request header | `x-current-path` in `proxy.ts` and `lib/api/errors.tsx` |
| Static shell with the user's data behind `<Suspense>` | `app/(app)/layout.tsx`, `components/app-sidebar.tsx` |
| `error.tsx` with `retry`, root `not-found.tsx`, `loading.tsx` | `app/error.tsx`, `app/not-found.tsx`, `app/(app)/loading.tsx` |
