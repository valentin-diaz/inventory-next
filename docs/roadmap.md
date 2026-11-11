# Roadmap: a Next.js frontend for the Inventario API

## Goal

A Spanish-language web app for the store chain that the Inventario API (`../../inventario`) runs.
Every role works from it:

- **Sellers** see their store's stock and record sales there.
- **Managers** run their stores: stock, movements, reorder levels, metrics and their sellers'
  accounts.
- The **superadmin** (head office) does all of that in every store, and also manages the catalog,
  the stores and the managers.

This is a personal project that only runs on localhost, next to the API. It should be simple but
correct: tokens never reach browser JavaScript, every screen respects the user's role and stores,
and API errors are shown to the user, never swallowed.

It is also a way to learn Next.js 16. Prefer what Next.js itself provides (Server Components,
Server Actions, `proxy.ts`) over libraries that hide it. Keep a "Where each Next.js concept lives"
table in the README, like the API's.

Each phase below gets its own implementation plan in `docs/plans/`, written with `/feature` before
it's built and implemented with `/implement-plan`.

## Where we start

- **A blank `create-next-app`:** Next 16.4.3, React 19.3, Tailwind CSS 4, TypeScript, ESLint. The
  only change so far is the home page title, "Store Chain Simulator".
- **`cacheComponents` and `partialPrefetching` are on** in `next.config.ts`. We keep both. See
  "Next.js 16 rules that shape the design".
- **The API is finished** for this scope: auth, stores, staff, catalog, per-store stock, movements
  and metrics. Its README documents every endpoint and rule, and its OpenAPI schema is at
  `http://localhost:8000/api/schema/`. Every path in the schema already includes its prefix
  (`/api/v1/products/`, `/api/health/`).

## How it fits together

```
Browser ──── cookies: access, refresh (httpOnly) ────▶ Next.js (localhost:3000)
                                                          │
                                                          │ Authorization: Bearer <access>
                                                          ▼
                                                       Django API (localhost:8000)
```

The browser only talks to Next.js, and only Next.js talks to Django:

- **Reads** happen in Server Components, which call the API with the user's access token.
- **Writes** are Server Actions, which forward the user's token. They don't need their own
  authorization checks, because the API authorizes every call.
- **`proxy.ts`** runs before every page request and keeps the access token fresh.

The browser never calls Django, so CORS is not involved. The tokens stay in httpOnly cookies, out
of reach of browser JavaScript, as the API's README recommends.

## Next.js 16 rules that shape the design

These rules differ from older Next.js versions and from most tutorials. Before each phase, read the
matching guide in `node_modules/next/dist/docs/`, as `AGENTS.md` requires.

| Rule | What it means here | Docs (`node_modules/next/dist/docs/01-app/`) |
| --- | --- | --- |
| Middleware is now called Proxy (`proxy.ts`), and it runs on Node.js. | Token refresh lives in `proxy.ts`. Because one Node process serves everything locally, concurrent refreshes can be de-duplicated in memory. | `01-getting-started/16-proxy.md`, `03-api-reference/03-file-conventions/proxy.md` |
| `cookies()` is async. Server Components can read cookies but not write them; only Server Functions, Route Handlers and Proxy can. | A page can't save a rotated refresh token, so tokens are refreshed in `proxy.ts`, before rendering. Login and logout are Server Actions. | `03-api-reference/04-functions/cookies.md` |
| With `cacheComponents`, reading cookies (or any request data) outside a `<Suspense>` boundary is a build error. | Every page that calls the API has a `loading.tsx` or a `<Suspense>`. The shell layout is static, and the user's name and stores stream in. A layout never awaits the session at its top level. | `02-guides/authentication-with-cache-components.md` |
| `params` and `searchParams` are Promises. | `await props.params`, typed with the global `PageProps<'/tiendas/[id]'>` helper (like the `LayoutProps<'/'>` already in `app/layout.tsx`). | `01-getting-started/03-layouts-and-pages.md` |
| `refresh()` from `next/cache` re-renders the current page from a Server Action. | Call it after a mutation that stays on the same page. | `01-getting-started/07-mutating-data.md` |
| `forbidden()` and `unauthorized()` are experimental, canary-only. | Don't use them. Render our own "No tienes permiso" message. | `03-api-reference/05-config/01-next-config-js/authInterrupts.md` |

## Decisions

| Question | Decision |
| --- | --- |
| UI language | Spanish. Code, file names and commits stay in English. Numbers, CLP prices and dates are formatted as `es-CL`. |
| URLs | Spanish, like the UI: `/tiendas`, `/movimientos`, `/catalogo`, `/personal`… |
| Where tokens live | Two httpOnly cookies, `access` and `refresh`, with `SameSite=Lax`, and `Secure` only outside development. Never in localStorage or in React state. |
| Auth library | None. Login and logout are two Server Actions, and refresh is a small function in `proxy.ts`. Auth.js would hide exactly what this project wants to learn, and its support for rotating refresh tokens is awkward. |
| Refreshing tokens | `proxy.ts` refreshes the access token when it's missing or expires in under 30 seconds. Concurrent refreshes that use the same refresh token share one request (see Phase 1). |
| Who decides permissions | The API. The UI reads `permissions`, `role` and `stores` from `/auth/me/`. Navigation and buttons follow `permissions`; `role` only picks the landing page and some wording. Every 403 and 404 from the API is still handled. |
| Talking to the API | `openapi-typescript` generates `lib/api/schema.d.ts` from the API's schema, and `openapi-fetch` turns it into a typed client: paths, query parameters, bodies and responses are all checked. The client is server-only. |
| Reading data | Server Components. Filters, search, ordering and page number live in the URL (`searchParams`), so every list can be linked and the back button works. |
| Writing data | Server Actions. Forms use `useActionState` for errors and the pending state, then call `redirect()` or `refresh()`. |
| Client-side data libraries | None: no TanStack Query and no SWR. Client Components are used only where something is interactive: forms, dialogs, the search box, charts. |
| Caching API data | None. Every API read needs the user's token, and the docs warn against putting tokens in `use cache` keys. The data also changes with every movement. Pages render on every request and stream behind Suspense. |
| UI components | shadcn/ui: Radix and Tailwind components copied into `components/ui/`, ours to edit. Charts use shadcn's chart component (Recharts). |
| API error messages | The API answers in English. The frontend writes its own Spanish messages for the errors it expects (wrong password, too many attempts, closed store, stock would go below zero, the 409s) and falls back to the API's text for the rest. See "Backend changes worth considering". |
| Codes the API returns | The API returns codes, not names, for regions, store statuses, movement types and roles. `lib/labels.ts` maps each one to its Spanish name, including all 16 regions. |
| "Today" | Default date ranges are computed in `America/Santiago`. The API counts each movement on its own store's calendar. |
| Movement times | Shown in their store's time zone. Movement responses only carry `{id, code, name}` for the store, so the time zone comes from the user's store list. |
| Tests | None for now. Each plan ends with manual checks per role, using the seed accounts. `npm run lint` and `npm run build` must pass. |
| Layout | A sidebar shell (shadcn Sidebar) that collapses on narrow screens. Light theme only for now. |

## Who sees what

| Screen | Seller | Manager | Superadmin |
| --- | --- | --- | --- |
| Inicio | Goes straight to their store | Summary of their stores | National summary |
| Tiendas | Goes straight to their store | Their stores | Every store; creates and edits them, changes their status |
| Tienda: stock | Reads | Reads, edits reorder levels | Same, everywhere |
| Tienda: movimientos | Reads, records sales | Reads, records sales, purchases and adjustments | Same, everywhere |
| Stock (all stores) | Their store | Their stores | Every store |
| Movimientos (explorer) | Their store | Their stores | Every store |
| Métricas | Their store | Their stores, by store or category | National, by region, store or category |
| Personal | Hidden | Their sellers: creates, moves, (de)activates | Everyone except superusers; also creates managers |
| Catálogo | Reads | Reads | Creates, edits, deletes |
| Perfil | Edits their name | Same | Same |

## Phases

Phases 0 to 3 are the core and come in order. After that, each phase only needs the core, except
Phase 5, which reuses Phase 4's filter bar. The order below is a suggestion.

| # | Phase | Plan |
| --- | --- | --- |
| 0 | Foundations | `plans/foundations.md` (to write) |
| 1 | Authentication and app shell | `plans/authentication.md` (to write) |
| 2 | Stores and their stock | `plans/stores-and-stock.md` (to write) |
| 3 | Recording movements | `plans/recording-movements.md` (to write) |
| 4 | Stock and movements across stores | `plans/cross-store-views.md` (to write) |
| 5 | Metrics dashboards | `plans/metrics.md` (to write) |
| 6 | Staff management | `plans/staff.md` (to write) |
| 7 | Catalog management | `plans/catalog.md` (to write) |
| 8 | Store management | `plans/store-management.md` (to write) |
| 9 | Polish | `plans/polish.md` (to write) |

### Phase 0: Foundations

**Why first.** Every later phase calls the API through the same client and builds its screens from
the same components.

- **Environment:** `API_URL=http://localhost:8000` in `.env.local`. It has no `NEXT_PUBLIC_`
  prefix, so it never reaches the browser. Commit a `.env.example`. `.gitignore` ignores `.env*`,
  so it needs a `!.env.example` line.
- **API types and client:**
  - An `npm run api:types` script that runs
    `openapi-typescript http://localhost:8000/api/schema/ -o lib/api/schema.d.ts`. Commit the
    generated file and re-run the script whenever the API changes.
  - `lib/api/client.ts`: an `openapi-fetch` client with `baseUrl` from `API_URL`, marked
    `import "server-only"`. It accepts an access token and sends it as `Authorization: Bearer`.
  - `lib/api/errors.ts`, with two helpers:
    - One for forms, which turns DRF error bodies into `{ formError, fieldErrors }`. DRF sends
      `{"detail": "…"}`, `{"<field>": ["…"]}` or `{"non_field_errors": ["…"]}`.
    - One for pages: a 404 calls `notFound()`, a 403 shows "No tienes permiso", and anything else
      throws to `error.tsx`. Phase 1 adds the 401 case.
  - A `Paginated<T>` type for DRF's `{ count, next, previous, results }`.
- **Spanish and formatting:**
  - `<html lang="es">` and Spanish metadata.
  - `lib/format.ts`: CLP prices, numbers, and dates in a given time zone, all with `Intl` and
    `es-CL`.
  - `lib/labels.ts`: Spanish names for regions, store statuses, movement types and roles.
- **UI:** run `npx shadcn@latest init`, which replaces the template's tokens in `globals.css`.
  Add the first components: button, input, label, card, table, badge, and sonner for toasts.
  Delete the template's unused images in `public/`.
- **Smoke test:** the home page calls `/api/health/` and shows "API conectada", or a Spanish error
  if the API is down.
- **README:** replace the boilerplate with how to run the app (API first, then `npm run dev`), the
  environment variables and the scripts. Start the "Where each Next.js concept lives" table.

**Verify:** with the API running, the home page says "API conectada". With the API stopped, it
shows the error message instead of crashing. `npm run lint` and `npm run build` pass.

### Phase 1: Authentication and app shell

**Why now.** Every other endpoint needs a token.

- **Login (`/login`):** an email and password form submitted to a `login` Server Action.
  - On success, the action sets both cookies and redirects to `?next=`, or to `/`. It accepts
    `next` only if it's a local path: it starts with `/` but not with `//`. Otherwise `next`
    could redirect to another site.
  - Spanish errors for wrong credentials (401) and too many attempts (429; the API allows 10 per
    minute). A deactivated account gets the same 401 as a wrong password.
- **Logout:** a Server Action that sends the refresh token to `/auth/token/blacklist/`, deletes
  both cookies and redirects to `/login`. It deletes the cookies even if the blacklist call fails.
- **`proxy.ts`:**
  1. The `matcher` skips static files (`_next/static`, `_next/image`, `favicon.ico`, images).
  2. It reads the `access` and `refresh` cookies and decodes the access token's `exp`. That's a
     base64 decode of the JWT payload; there's no need to check the signature, because Django
     does.
  3. If the access token is valid for more than 30 more seconds, the request continues as is.
  4. If it isn't, and there's a refresh token, the proxy calls `/auth/token/refresh/`:
     - On success, it sets the new cookies on the **request**, using
       `NextResponse.next({ request: { headers } })`, so this render already uses them. It also
       sets them on the **response**, so the browser keeps them.
     - On a 401 (refresh token expired or blacklisted), it deletes both cookies.
  5. Without a valid session, a protected route redirects to `/login?next=<path>`. With one,
     `/login` redirects to `/`.
- **Concurrent refreshes.** The API rotates refresh tokens and blacklists the old one. The browser
  often sends several requests at once, such as a navigation plus prefetches of the sidebar links,
  and each one reaches `proxy.ts` with the same expired access token. If each request refreshed on
  its own, the first would win and the others would be rejected as blacklisted, logging the user
  out at random.
  - Fix: a module-level `Map<refreshToken, Promise<result>>`, so concurrent requests share one
    refresh.
  - Keep each entry about 30 seconds after it settles, so requests that arrive just after the
    refresh reuse its result.
  - This works because `proxy.ts` runs on Node.js and only one server runs locally.
- **Session expired mid-render.** The API can still answer 401 after the proxy let a request
  through, for example when a manager deactivates someone. Pages can't delete cookies, and
  redirecting straight to `/login` would loop: the proxy still sees an access token that looks
  valid and sends the user back to `/`.
  - Fix: a small Route Handler (e.g. `app/(auth)/salir/route.ts`) that deletes the cookies and
    redirects to `/login?next=…`.
  - The page error helper from Phase 0 sends every 401 there.
- **Data Access Layer (`lib/auth.ts`):**
  - `getCurrentUser()` calls `/auth/me/`. It's wrapped in React's `cache()`, so a layout and its
    page share one API call per request. It returns a narrow type: id, email, names, role,
    permissions, stores.
  - `can(user, "inventory.record_purchase")` checks one permission.
- **Route groups:**
  - `app/(auth)/` holds the login page, which has no shell.
  - `app/(app)/` holds every other page, inside the shell: a shadcn Sidebar with navigation built
    from `permissions`, and a user menu with the name, the role and "Cerrar sesión". The user
    menu reads cookies, so it sits behind a `<Suspense>` with a skeleton.
  - `loading.tsx`, `error.tsx` and `not-found.tsx` for `(app)`.
- **Landing:** `/` sends a seller to their store, which Phase 2 builds. Managers and the
  superadmin get a placeholder "Inicio" page until Phase 5.

**Verify:**

- Log in as each seed role (password `inventario-demo`).
- A wrong password shows the Spanish error. Eleven fast attempts show the "too many attempts"
  message.
- `seller.ipc01@example.com`, who is deactivated, can't log in.
- After logging out, the browser's back button shows no data.
- Opening `/tiendas` while logged out goes to the login page, then back to `/tiendas`.
- In the browser console, `document.cookie` doesn't show the tokens.
- Refresh test:
  - Temporarily add
    `SIMPLE_JWT = {**SIMPLE_JWT, "ACCESS_TOKEN_LIFETIME": timedelta(minutes=1)}` to the API's
    `config/settings/dev.py`. Don't commit it.
  - Browse for a few minutes with several tabs open. You never get logged out.
  - Keep the test short. A one-minute token refreshes 60 times an hour, and the API allows only
    100 anonymous requests an hour from what it sees as a single client.

### Phase 2: Stores and their stock

- **`/tiendas`:** code, name, city, region name and a status badge. Search, region and status
  filters, ordering and pagination. A seller goes straight to their store.
- **`/tiendas/[id]`:** the store's details (address, phone, opening date, time zone). A store that
  isn't open shows a banner: "Tienda cerrada temporalmente: solo lectura". A store outside the
  user's scope gets a 404 from the API, which the page shows as `notFound()`.
- **`/tiendas/[id]/stock`:** SKU, product, quantity, reorder level, and a "Sin stock" / "Stock
  bajo" badge. Search, low and out-of-stock filters, ordering and pagination.
- **Building blocks later phases reuse:**
  - A server-rendered table with sortable header links.
  - `Pagination`.
  - A debounced `SearchInput`, a Client Component that updates the URL with `router.replace`.
  - Filter selects.
  - Helpers that read list parameters from `searchParams` and write them back.
- **Store switcher:** a dropdown in the shell for users with more than one store.

**Verify:**

- `manager.centro` sees only STG-01, STG-02 and VIN-01. Typing another store's id in the URL shows
  the 404 page.
- STG-01 shows the out-of-stock and low-stock products from the seed.
- As admin, the closed store IPC-01 shows the read-only banner.
- Filters survive a reload and the back button.

### Phase 3: Recording movements

**The seller's main job**, so it has to be quick and impossible to get subtly wrong.

- **`/tiendas/[id]/movimientos`:** the store's history. Each row shows the date and time (in the
  store's time zone), product, type, signed quantity, balance after, reason and user. Filters by
  type and product, and pagination.
- **`/tiendas/[id]/movimientos/nuevo`:** the form to record a movement.
  - It has a product picker, a type and a number of units. It only offers the types the user has
    permission for (`record_sale`, `record_purchase`, `record_adjustment`).
  - Users always type a positive number, and the form applies the sign: a sale is sent as
    negative, a purchase as positive. An adjustment has "Sumar" or "Restar" and a required reason.
  - The form shows the product's current stock in this store and the balance after the movement.
  - Movements aren't idempotent: a double click would record twice. The submit button is disabled
    while the action is pending.
  - Errors: stock would go below zero (400), store not open (403), type not allowed (403).
  - After success: a toast, then the history.
- **Product picker:** a combobox over the active catalog.
  - The catalog has 28 products, so the server loads one page of 100 and the browser filters it.
    If the catalog ever outgrows that page, switch to a Route Handler that searches
    `/products/?search=`.
  - The plan decides one detail. A purchase can bring a product the store has never carried, so
    purchases need the whole catalog; sales may only need products the store has in stock.
- **Reorder levels:** an edit dialog on the stock page for users with `change_storestock`. It
  sends a PATCH to `/stores/{id}/stock/{product_id}/`.
- **Stores that aren't open:** the record and edit actions are hidden, and a 403 is still handled
  if one gets through.

**Verify:**

- `seller.stg01` can only pick "Venta". A sale of 2 updates the balance and appears in the
  history with their email.
- Selling more than the stock shows a Spanish error, and nothing is recorded.
- A manager's purchase of a product the store never had creates its stock row.
- An adjustment without a reason is rejected.
- A double click records the movement once.
- A closed store shows no actions.
- Changing a reorder level changes the low-stock badge.

### Phase 4: Stock and movements across stores

- **`/stock`** (`/api/v1/stock/`): the stock table with a store column. Filters by store (only
  the user's), region, category, product, low and out of stock. Search and ordering.
- **`/movimientos`** (`/api/v1/movements/`): the movement explorer. Filters by store, region,
  category, product, type, user and date range. Both dates are inclusive.
- **User filter:** the `user` filter takes an id, picked from `/staff/` for users who can see it.
  Managers only see their sellers there. Sellers get no user filter.
- **A reusable `FilterBar`**, which Phase 5 also uses.
- **Out-of-scope filters:** filtering by a store the user can't access answers 400. The UI only
  offers the user's own stores, but a hand-edited URL still shows a message instead of crashing.

**Verify:** `manager.sur` only sees CCP-01 and PUQ-01 rows. Combined filters and date ranges
work, and a copied URL reproduces the same view.

### Phase 5: Metrics dashboards

- **Stock totals (`/metrics/stock/`):**
  - Cards for units, value (CLP), products carried, low stock and out of stock.
  - Grouped by store, region or category as a table plus a bar chart. The API returns a store id,
    region code or category id for each group; the page turns them into names.
- **Movement flows (`/metrics/movements/`):**
  - An interval (día, semana, mes), a date range and the Phase 4 filters. The default range is
    computed in `America/Santiago`.
  - A chart of units per movement type, with sales shown as outflows since they're negative, plus
    the net.
  - Check the API's 366-period limit before sending the request, so a year of days doesn't come
    back as an error.
- **Charts** are Client Components that receive their data from the Server Component that
  fetched it. Labels are in Spanish and numbers formatted as `es-CL`.
- **Landing:** "Inicio" becomes a summary of these totals for the user's stores.

**Verify:**

- The totals match `/stock` with the same filters.
- Weeks start on Monday.
- Each role only sees numbers for its own stores.

### Phase 6: Staff management

- **`/personal`** (needs `accounts.view_user`): name, email, role, stores and active state, with
  search and pagination.
- **`/personal/nuevo`:**
  - Email, first and last name, password, role and stores. A manager can only create sellers.
  - Stores are a choice among the user's open stores. A seller gets exactly one.
  - The API's password validator errors show up next to the password field.
- **`/personal/[id]`:**
  - Edit names and stores (moving a seller is a store change). Activate or deactivate, with a
    confirmation.
  - The assignment history, from `/staff/{id}/assignments/`.
  - Email, role and password can't change after creation, so they're shown read-only.

**Verify:**

- `manager.centro` creates a seller in STG-02, who can then log in.
- Moving them to VIN-01 shows both stores in their history.
- Deactivating them signs them out on their next request, through Phase 1's session-expired
  handler.
- A manager is never offered the manager role, and closed stores are never offered.
- A weak password shows the validator's message.

### Phase 7: Catalog management

- **`/catalogo`:** everyone can read it; only the superadmin sees the write actions.
- **Products:**
  - SKU, name, category, CLP price and active state. Search, category, active and price filters,
    and ordering.
  - A create and edit form. Active products need a price above zero.
  - Delete asks for confirmation. A product with movements answers 409, and the message offers to
    deactivate it instead.
- **Categories:** the list with `product_count`, and create and edit. Deleting a category that
  still has products answers 409.

**Verify:**

- A seller sees the catalog without edit actions.
- A new product appears in Phase 3's product picker.
- Deleting a product with movements shows the 409 message and the option to deactivate it.

### Phase 8: Store management

- **Superadmin only:** `/tiendas/nueva` and `/tiendas/[id]/editar`.
- **Fields:**
  - Code, with a format hint like `STG-01`.
  - Name, address and city.
  - Region, as a select of all 16.
  - Time zone, as a select of 3, `America/Santiago` by default.
  - Phone and opening date.
  - Status.
- **Status changes:** changing the status asks for confirmation and explains that a store that
  isn't open becomes read-only. The API has no delete; closing a store replaces it.

**Verify:**

- An invalid code and a duplicate code each show a field error.
- Closing a store makes it read-only in the Phase 2 and 3 screens.
- A manager sees no edit actions.

### Phase 9: Polish

- **`/perfil`:** edit your own first and last name (`PATCH /auth/me/`). The API has no password
  change.
- **Empty states** for every list, and consistent loading skeletons.
- **Usability:** a pass over the Spanish copy, keyboard use in forms and dialogs, and a check on
  narrow screens.
- **README:** finish the "Where each Next.js concept lives" table.

## In every phase

- Read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- Write all UI copy in Spanish. English only appears as a fallback for unexpected API messages.
- Hide what `permissions` don't allow, and still handle 403 and 404 from the API.
- Every list keeps its state in the URL.
- `npm run lint` and `npm run build` pass. The build is also the type check, and it catches
  request-time reads outside a Suspense boundary.
- Re-run `npm run api:types` if the API changed.
- Check by hand with the seed accounts, at least one per role involved.
- Update the README's concept table.

## Backend changes worth considering

The frontend needs none of these, but each would help:

- **Spanish error messages.** `LANGUAGE_CODE = "es"` in the API translates Django's, DRF's and
  Simple JWT's built-in messages: required fields, invalid choices, password validators, wrong
  credentials. The API's own messages stay in English unless they're wrapped in `gettext`. Tests
  that check message text may need `LANGUAGE_CODE = "en-us"` in `config/settings/test.py`.
- **Throttling.** Every request comes from the Next.js server, so the API sees a single client.
  The anonymous limit (100 an hour) covers every login and token refresh. Each user is limited to
  1000 requests an hour, and a dashboard makes several API calls per page load. If you hit 429
  while developing, raise the rates in `dev.py`.
- **The store's time zone in movement responses.** Adding `timezone` to `StoreSummarySerializer`
  would save the frontend a lookup.

## Later

Out of scope for now. Revisit once the phases above are done.

- Dark mode. The shadcn tokens already support it.
- Tests: Vitest for the pure helpers (token expiry, DRF error mapping, formatters) and Playwright
  for one flow per role.
- `use cache: private` on `getCurrentUser()`, for instant navigations. See step 1 of
  `02-guides/authentication-with-cache-components.md`.
- A product search Route Handler, once the catalog outgrows one page.
- Live dashboards, if the API gets its activity simulator.
- Whatever the API adds from its own "Later" list, such as transfers between stores, or sales and
  returns.
