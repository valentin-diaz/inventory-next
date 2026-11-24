# Los usuarios inician sesión, la sesión se renueva sola y cada página vive dentro del shell

## Context

Hoy el frontend no sabe quién está usando la app:

- **`lib/api/client.ts`:** `createApiClient(accessToken?)` crea un cliente `openapi-fetch` tipado, solo de servidor, y agrega `Authorization: Bearer <token>` cuando recibe un token. Nadie le pasa uno todavía. Su comentario ya avisa: *"Call it once per request and pass that request's access token (Phase 1). Never keep a token at module level."*
- **`lib/api/errors.tsx`:** `renderApiErrorForPage(response)` manda un 404 a `notFound()`, devuelve `<PermissionDenied />` para un 403 y lanza un `Error` para todo lo demás. Un **401** hoy termina en la página de error por defecto de Next.js, en inglés.
- **`app/page.tsx`:** es el smoke test de la Fase 0 ("API conectada").
- **`app/layout.tsx`:** el layout raíz en español, con el `<Toaster />`.
- **No hay `proxy.ts`, ni login, ni `error.tsx`, ni `not-found.tsx`.**

Lo que importa de la API (`../../inventario`):

- **`POST /api/v1/auth/token/`** recibe `{email, password}` y responde `{access, refresh}`. Con credenciales malas, o con una cuenta desactivada, responde **401**. El login tiene un límite propio de **10 intentos por minuto** (`throttle_scope = "auth"`), y al pasarlo responde **429**.
- **`POST /api/v1/auth/token/refresh/`** recibe `{refresh}` y responde un par **nuevo**, `{access, refresh}`.
- **`POST /api/v1/auth/token/blacklist/`** recibe `{refresh}` y lo anula.
- **`GET /api/v1/auth/me/`** devuelve el `User`: `id`, `email`, `first_name`, `last_name`, `is_staff`, `date_joined`, `permissions: string[]`, `role: string | null` y `stores: {id, code, name}[]`.
- **`SIMPLE_JWT`** (`config/settings/base.py`, líneas 166–172):
  - el access dura 15 minutos y el refresh 7 días;
  - `ROTATE_REFRESH_TOKENS` y `BLACKLIST_AFTER_ROTATION` están activos: cada refresh entrega un refresh nuevo y anula el anterior, así que **reusar un refresh token da 401**.
- **Cada request a la API vuelve a buscar al usuario en la base de datos** (`rest_framework_simplejwt/authentication.py`: línea 125 saca el `user_id` del token, línea 132 lo busca, línea 138 revisa que siga activo). El token no lleva permisos: un cambio de permisos o una desactivación se notan en el siguiente request.
- **Sin token, o con uno inválido o vencido, la API responde 401**, no 403. `InvalidToken` declara `status_code = HTTP_401_UNAUTHORIZED` con *"Token is invalid or expired"* (`rest_framework_simplejwt/exceptions.py`, líneas 53–56). Un 401 dice "no sé quién eres" y un 403 dice "sé quién eres, pero no puedes" ([DRF — Unauthorized and Forbidden responses](https://www.django-rest-framework.org/api-guide/authentication/#unauthorized-and-forbidden-responses)).

**Qué falta.** Cada pantalla de las fases siguientes necesita el token del usuario, y la app todavía no lo obtiene, no lo guarda, no lo renueva ni lo descarta. Tampoco hay shell: ni sidebar, ni menú de usuario, ni páginas de carga y de error.

**La idea clave.** Django es el único que decide quién es el usuario y qué puede hacer. Next.js solo **guarda las llaves** del usuario, que nunca toca los tokens, y hace cinco cosas con ellas:

1. **Obtener:** el login cambia email y contraseña por los tokens.
2. **Guardar:** los deja en dos cookies `httpOnly`, `access` y `refresh`.
3. **Usar:** pone el access en cada request a la API.
4. **Renovar:** `proxy.ts` lo refresca **antes** del render.
5. **Descartar:** el logout y `/salir` borran las cookies.

```
Navegador ── Cookie: access=… ──▶ Next.js ── Authorization: Bearer … ──▶ Django
  (lo pone el navegador solo)       (lo lee y lo cambia de sobre)       (verifica la firma)
```

El refresh vive en el proxy porque un Server Component **no puede escribir cookies**: *"HTTP does not allow setting cookies after streaming starts"* ([cookies — Good to know](https://nextjs.org/docs/app/api-reference/functions/cookies#good-to-know); local: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, líneas 71–74). Si un componente refrescara durante el render, la API ya habría anulado el refresh viejo y el nuevo se perdería: el usuario quedaría fuera en su siguiente request.

## Approach

Nueve pasos, cada uno es un commit:

1. Helpers de sesión y de redirección local.
2. Login: página, formulario y Server Action.
3. `proxy.ts`: refresco, cookies y redirecciones.
4. Sesión vencida: `/salir` y el caso 401.
5. Data Access Layer: `getCurrentUser()` y `can()`.
6. Shell y página de Inicio.
7. Logout.
8. Páginas de carga, de error y 404.
9. README y roadmap.

El orden sigue las dependencias y permite probar cada paso:

- el login, el proxy y `/salir` comparten los nombres y las opciones de las cookies del paso 1;
- el proxy necesita tokens reales para probarse, así que va después del login;
- el caso 401 usa el header con la ruta actual que pone el proxy;
- el DAL usa el caso 401;
- el shell y el Inicio usan el DAL;
- el logout es un botón del shell.

### Step 1 — Crear los helpers de sesión y de redirección local

Cuatro piezas escriben o borran las mismas dos cookies: el proxy, el action de login, el logout y `/salir`. Si cada una definiera sus opciones, bastaría un descuido para que una cookie quedara sin `httpOnly`. Por eso los nombres, las opciones y el decodificador de `exp` viven en un solo módulo, como el `app/lib/session.ts` que la guía de Next.js importa desde su `proxy.ts`, su login y su logout ([Authentication — Optimistic checks with Proxy](https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-proxy-optional); local: `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, líneas 1037–1040, 680 y 803).

El segundo helper valida el `?next=` del login. Sin él, un link `/login?next=https://malo.com` mandaría al usuario, recién autenticado, a otro sitio.

**What we'll implement:**
- Crear `lib/session.ts`, marcado `import "server-only"`, con:
  - `accessTokenCookieName` (`"access"`), `refreshTokenCookieName` (`"refresh"`) y `accessTokenRefreshMarginSeconds` (30);
  - el tipo `TokenPair` (`access`, `refresh`);
  - `readTokenExpiry(token)`: decodifica el payload del JWT **sin verificar la firma** y devuelve `exp`, o `null` si el token no se puede leer;
  - `isAccessTokenFresh(accessToken)`: `true` si al token le quedan más de 30 segundos;
  - `tokenCookieOptions(token)`: `httpOnly`, `sameSite: "lax"`, `secure` solo en producción, `path: "/"` y `maxAge` igual a lo que le queda al token;
  - `writeTokenCookies(cookieStore, tokens)` y `deleteTokenCookies(cookieStore)`, que sirven tanto para `response.cookies` del proxy como para `cookies()` de un action.
- Crear `lib/local-redirect-path.ts` con:
  - `currentPathRequestHeaderName` (`"x-current-path"`), el header con el que el proxy le pasa la ruta actual al render (paso 4);
  - `toSafeLocalRedirectPath(candidate)`: devuelve la ruta si es local y no es `/login` ni `/salir`; si no, devuelve `"/"`.

`lib/session.ts` (nuevo)
```diff
+import "server-only";
+
+export const accessTokenCookieName = "access";
+export const refreshTokenCookieName = "refresh";
+
+/** Refresh the access token when it has less than this left, so it can't expire mid-render. */
+export const accessTokenRefreshMarginSeconds = 30;
+
+export type TokenPair = { access: string; refresh: string };
+
+type TokenCookieOptions = {
+  httpOnly: true;
+  sameSite: "lax";
+  secure: boolean;
+  path: "/";
+  maxAge: number;
+};
+
+/** What both `response.cookies` (proxy) and `await cookies()` (Server Function) offer. */
+type WritableCookieStore = {
+  set(name: string, value: string, options: TokenCookieOptions): unknown;
+  delete(name: string): unknown;
+};
+
+/**
+ * Reads `exp` (seconds since the epoch) from a JWT payload WITHOUT checking its signature.
+ * Only good for deciding when to refresh: Django checks the signature on every API call.
+ * Returns null for anything that isn't a readable JWT, so a garbage cookie can't crash the proxy.
+ */
+export function readTokenExpiry(token: string): number | null {
+  const payloadSegment = token.split(".")[1];
+  if (!payloadSegment) return null;
+  try {
+    const payload: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
+    if (typeof payload === "object" && payload !== null && "exp" in payload) {
+      return typeof payload.exp === "number" ? payload.exp : null;
+    }
+    return null;
+  } catch {
+    return null;
+  }
+}
+
+export function isAccessTokenFresh(accessToken: string | undefined): boolean {
+  if (!accessToken) return false;
+  const expiry = readTokenExpiry(accessToken);
+  return expiry !== null && expiry - Date.now() / 1000 > accessTokenRefreshMarginSeconds;
+}
+
+/** The cookie lives exactly as long as its token, so the browser drops dead tokens by itself. */
+export function tokenCookieOptions(token: string): TokenCookieOptions {
+  const expiry = readTokenExpiry(token);
+  const secondsUntilExpiry = expiry === null ? 0 : Math.max(0, Math.floor(expiry - Date.now() / 1000));
+  return {
+    httpOnly: true,
+    sameSite: "lax",
+    secure: process.env.NODE_ENV === "production",
+    path: "/",
+    maxAge: secondsUntilExpiry,
+  };
+}
+
+export function writeTokenCookies(cookieStore: WritableCookieStore, tokens: TokenPair): void {
+  cookieStore.set(accessTokenCookieName, tokens.access, tokenCookieOptions(tokens.access));
+  cookieStore.set(refreshTokenCookieName, tokens.refresh, tokenCookieOptions(tokens.refresh));
+}
+
+export function deleteTokenCookies(cookieStore: WritableCookieStore): void {
+  cookieStore.delete(accessTokenCookieName);
+  cookieStore.delete(refreshTokenCookieName);
+}
```

`lib/local-redirect-path.ts` (nuevo)
```diff
+/** Request header the proxy sets so a Server Component can tell which page it is rendering. */
+export const currentPathRequestHeaderName = "x-current-path";
+
+// Any origin works as a base: we only compare it with the origin the parser ends up with.
+const parsingBaseOrigin = "http://local-redirect.invalid";
+
+// Sending someone here after logging in would bounce them (/login) or log them out again (/salir).
+const pathsThatAreNeverRedirectTargets = ["/login", "/salir"];
+
+/**
+ * Returns `candidate` if it is a path on this site, otherwise "/".
+ * Parses with URL instead of checking prefixes: "/\malo.com" starts with "/" and not with "//",
+ * but the URL parser reads it as "//malo.com", another site.
+ */
+export function toSafeLocalRedirectPath(candidate: string | null | undefined): string {
+  if (!candidate || !candidate.startsWith("/")) return "/";
+
+  let parsedCandidate: URL;
+  try {
+    parsedCandidate = new URL(candidate, parsingBaseOrigin);
+  } catch {
+    return "/";
+  }
+  if (parsedCandidate.origin !== parsingBaseOrigin) return "/";
+
+  const pathnameWithoutTrailingSlash = parsedCandidate.pathname.replace(/\/+$/, "") || "/";
+  if (pathsThatAreNeverRedirectTargets.includes(pathnameWithoutTrailingSlash)) return "/";
+
+  return parsedCandidate.pathname + parsedCandidate.search + parsedCandidate.hash;
+}
```

Qué notar:

- **Leer no es confiar.** Un JWT son tres partes en Base64-URL: header, payload y firma. Cualquiera puede leer el payload, *"though protected against tampering, is readable by anyone"* ([jwt.io — Introduction](https://www.jwt.io/introduction), sección "Payload"). Solo Django, que tiene la clave, puede fabricar una firma válida. Por eso `readTokenExpiry` sirve para decidir **cuándo** refrescar, pero nunca como prueba de identidad.
- **La regla del roadmap tiene un hueco.** "Empieza con `/` pero no con `//`" deja pasar `/\malo.com`. En el URL Standard, para `http` y `https`, `\` cuenta como `/`: es solo un *"invalid-reverse-solidus validation error"* y el parser sigue ([WHATWG URL — URL parsing](https://url.spec.whatwg.org/#url-parsing), "relative slash state"). OWASP recomienda justamente comparar los componentes ya parseados y redirigir con la URL validada, no con el texto original ([OWASP — Validating URLs](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html#validating-urls)). Eso hace la función.
- **`/login` y `/salir` tampoco son destinos.** Con `/login?next=/salir`, el login funcionaría y `/salir` cerraría la sesión al tiro: parecería que el login falla. La barra final se quita antes de comparar, porque `/salir/` también llega a `/salir`.
- **`secure` solo en producción.** Es la decisión "Where tokens live" del roadmap ([docs/roadmap.md:76](docs/roadmap.md#L76)). Con `next start`, `NODE_ENV` es `production`. Igual funciona en `http://localhost`, porque *"The `https:` requirements are ignored when the `Secure` attribute is set by localhost"* ([MDN — Set-Cookie, `Secure`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#secure)).
- **`httpOnly` es la razón de todo el diseño.** Una cookie `httpOnly` *"can't be accessed by JavaScript … This precaution helps mitigate cross-site scripting (XSS) attacks"* ([MDN — Block access to your cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#block_access_to_your_cookies)). Si un script inyectado lograra correr en la página, no podría llevarse los tokens. Sí podría hacer requests desde la página mientras está abierta, así que `httpOnly` protege pero no reemplaza evitar el XSS.
- **`SameSite=Lax`** hace que el navegador no adjunte la cookie a un `POST` que viene de otro sitio. Es la primera defensa contra CSRF (ver el paso 2).
- **`Buffer`** existe porque el proxy corre en Node.js (*"Proxy defaults to using the Node.js runtime"*, [proxy.js — Runtime](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#runtime)).

**Known uncertainty.**
- **`server-only` dentro del proxy.** El proxy importa este módulo. La guía de Next.js hace lo mismo con un `session.ts` que empieza con `import 'server-only'` (`authentication.md`, línea 569), pero no se comprobó con Turbopack en esta versión. Si `npm run build` o `next dev` fallan en el paso 3 por ese import, quítalo de `lib/session.ts`: el módulo no lee secretos, así que no pierde nada importante.
- **El tipo `WritableCookieStore`.** `response.cookies.set` y `(await cookies()).set` tienen varias sobrecargas. Si TypeScript no acepta alguna como `WritableCookieStore`, cambia el tipo por `Pick<ResponseCookies, "set" | "delete">`, importando `ResponseCookies` desde `next/server`.

**Verify:** `npm run lint` y `npm run build` pasan. Nadie usa todavía estos helpers.

**Suggested commit name:** `feat: add session cookie and local redirect helpers`

### Step 2 — Crear la página de login y su Server Action

El login es la primera de las cinco cosas: obtener los tokens. Va en `app/(auth)/login/`, un grupo de rutas fuera del shell. Los paréntesis no entran en la URL, así que la página queda en `/login` ([Route Groups — Convention](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups#convention); local: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md`, líneas 10–12).

El formulario es un Client Component con `useActionState`, pero el action **corre en el servidor**: *"A Server Function is an asynchronous function that runs on the server. You can call them from the client through a network request"*, y *"actions use the `POST` method"* ([Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data#what-are-server-functions); local: `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`, líneas 18 y 29). La contraseña viaja del navegador a Next.js en ese `POST`, y de ahí a Django. Los tokens vuelven al navegador solo como `Set-Cookie` en la respuesta, y el código del componente nunca los ve.

**What we'll implement:**
- Crear `app/(auth)/login/actions.ts` (`"use server"`) con:
  - el tipo `LoginFormState` (`message`, `email`);
  - `logInWithEmailAndPassword(previousState, formData)`:
    - con email o contraseña vacíos, devuelve "Escribe tu email y tu contraseña.";
    - envuelve en `try` **solo** la llamada a `POST /api/v1/auth/token/`, y si la API no responde devuelve "No se pudo conectar con la API.";
    - con 401, devuelve "El email o la contraseña no son correctos.";
    - con 429, devuelve "Demasiados intentos. Espera un minuto e intenta de nuevo.";
    - con otro error, devuelve "No se pudo iniciar sesión. Intenta de nuevo." y lo registra con `console.error`;
    - si todo sale bien, guarda las dos cookies y redirige a `toSafeLocalRedirectPath(next)`, **fuera** del `try`;
    - el estado siempre lleva el email escrito, nunca la contraseña ni los tokens.
- Crear `app/(auth)/login/login-form.tsx` (`"use client"`) con `LoginForm`:
  - lee `next` con `useSearchParams()` y lo manda en un input oculto;
  - inputs `email` y `password` con `required`; el email toma su valor de `state.email`;
  - muestra `state.message` con `role="alert"`;
  - deshabilita el botón mientras `isPending`.
- Crear `app/(auth)/login/page.tsx` con `LoginPage`: una `Card` con el título "Iniciar sesión" y el formulario dentro de `<Suspense>`, más `metadata` con el título "Iniciar sesión".

`app/(auth)/login/actions.ts` (nuevo)
```diff
+"use server";
+
+import { cookies } from "next/headers";
+import { redirect } from "next/navigation";
+
+import { createApiClient } from "@/lib/api/client";
+import { toSafeLocalRedirectPath } from "@/lib/local-redirect-path";
+import { writeTokenCookies } from "@/lib/session";
+
+/** Everything in here reaches the browser: never put the password or the tokens in it. */
+export type LoginFormState = { message: string | null; email: string };
+
+export async function logInWithEmailAndPassword(
+  previousState: LoginFormState,
+  formData: FormData,
+): Promise<LoginFormState> {
+  const email = String(formData.get("email") ?? "").trim();
+  const password = String(formData.get("password") ?? "");
+  const pathAfterLogin = toSafeLocalRedirectPath(String(formData.get("next") ?? ""));
+
+  if (!email || !password) {
+    return { message: "Escribe tu email y tu contraseña.", email };
+  }
+
+  // The try wraps only the call that can fail on the network. redirect() below throws on
+  // purpose; inside the try, the catch would swallow it and show a false "can't connect".
+  let tokenResult;
+  try {
+    tokenResult = await createApiClient().POST("/api/v1/auth/token/", { body: { email, password } });
+  } catch (error) {
+    console.error("No se pudo conectar con la API:", error);
+    return { message: "No se pudo conectar con la API.", email };
+  }
+
+  const { data: tokens, response } = tokenResult;
+  if (response.status === 401) {
+    // Also what a deactivated account gets: the API doesn't tell them apart, and neither do we.
+    return { message: "El email o la contraseña no son correctos.", email };
+  }
+  if (response.status === 429) {
+    return { message: "Demasiados intentos. Espera un minuto e intenta de nuevo.", email };
+  }
+  if (!tokens) {
+    console.error(`La API respondió ${response.status} al iniciar sesión.`);
+    return { message: "No se pudo iniciar sesión. Intenta de nuevo.", email };
+  }
+
+  writeTokenCookies(await cookies(), tokens);
+  redirect(pathAfterLogin);
+}
```

`app/(auth)/login/login-form.tsx` (nuevo)
```diff
+"use client";
+
+import { useSearchParams } from "next/navigation";
+import { useActionState } from "react";
+
+import { Button } from "@/components/ui/button";
+import { Input } from "@/components/ui/input";
+import { Label } from "@/components/ui/label";
+
+import { logInWithEmailAndPassword, type LoginFormState } from "./actions";
+
+const initialLoginFormState: LoginFormState = { message: null, email: "" };
+
+export function LoginForm() {
+  const searchParams = useSearchParams();
+  const [state, formAction, isPending] = useActionState(
+    logInWithEmailAndPassword,
+    initialLoginFormState,
+  );
+
+  return (
+    <form action={formAction} className="flex flex-col gap-4">
+      {/* Validated again on the server: never trust what the browser sends. */}
+      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
+      <div className="flex flex-col gap-2">
+        <Label htmlFor="email">Email</Label>
+        <Input
+          id="email"
+          name="email"
+          type="email"
+          autoComplete="email"
+          required
+          defaultValue={state.email}
+        />
+      </div>
+      <div className="flex flex-col gap-2">
+        <Label htmlFor="password">Contraseña</Label>
+        <Input id="password" name="password" type="password" autoComplete="current-password" required />
+      </div>
+      {state.message && (
+        <p role="alert" className="text-sm text-destructive">
+          {state.message}
+        </p>
+      )}
+      <Button type="submit" disabled={isPending}>
+        {isPending ? "Ingresando…" : "Ingresar"}
+      </Button>
+    </form>
+  );
+}
```

`app/(auth)/login/page.tsx` (nuevo)
```diff
+import type { Metadata } from "next";
+import { Suspense } from "react";
+
+import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
+
+import { LoginForm } from "./login-form";
+
+export const metadata: Metadata = { title: "Iniciar sesión" };
+
+export default function LoginPage() {
+  return (
+    <main className="flex flex-1 items-center justify-center px-4 py-16">
+      <Card className="w-full max-w-sm">
+        <CardHeader>
+          <CardTitle>Iniciar sesión</CardTitle>
+          <CardDescription>Simulador de Cadena de Tiendas</CardDescription>
+        </CardHeader>
+        <CardContent>
+          {/* LoginForm reads the URL (?next=), which is request data: it streams in. */}
+          <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
+            <LoginForm />
+          </Suspense>
+        </CardContent>
+      </Card>
+    </main>
+  );
+}
```

Qué notar:

- **La trampa de `redirect()` dentro del `try`.** `redirect()` no navega por sí solo: *"Invoking the `redirect()` function throws a `NEXT_REDIRECT` error"*, y *"should be called **outside** the `try` block when using `try/catch` statements"* ([redirect — Behavior](https://nextjs.org/docs/app/api-reference/functions/redirect#behavior); local: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`, líneas 49–53 y 62). El build no lo revisa. Dentro del `try`, el `catch` atraparía el redirect y Ana vería "No se pudo conectar con la API." con un login que en realidad funcionó.
- **Qué lleva el estado.** Todo lo que devuelve el action se serializa y llega al navegador. Por eso lleva el mensaje y el email, que se conserva como decidiste, pero nunca la contraseña ni los tokens.
- **Una cuenta desactivada recibe el mismo 401** que una contraseña mala, y mostramos el mismo mensaje. Decir "tu cuenta está desactivada" le confirmaría a un extraño que ese email existe.
- **La validación de `next` ocurre en el servidor.** El input oculto lo puede cambiar cualquiera, así que el action vuelve a pasarlo por `toSafeLocalRedirectPath`.
- **CSRF.** Un Server Action se puede invocar desde un `<form>` de otro sitio, y esa es la forma del ataque CSRF. Lo frenan dos capas independientes ([Data Security — Allowed origins](https://nextjs.org/docs/app/guides/data-security#allowed-origins-advanced); local: `node_modules/next/dist/docs/01-app/02-guides/data-security.md`, líneas 546–550):
  1. con `SameSite=Lax`, el navegador no adjunta las cookies a ese `POST`;
  2. Next.js compara `Origin` con `Host` y aborta el request si no coinciden.

  `serverActions.allowedOrigins` sirve para **sumar** orígenes de confianza, no para bloquear más. No lo usamos.
- **Sin `<Suspense>`, el build falla.** `useSearchParams()` lee datos del request, así que el formulario no entra al static shell de `/login`. El título de la `Card` sí entra.

**Known uncertainty.**
- **El reset automático del formulario.** React 19 resetea un `<form>` después de que corre su action. El email debería volver con el valor de `defaultValue={state.email}`. Si después de un error el input aparece vacío, agrega `key={state.email}` al `<Input>` del email para que React lo vuelva a montar con el valor nuevo.
- **Los tipos de `/auth/token/`.** El diff asume que `data` trae `access` y `refresh` como `string` en `lib/api/schema.d.ts`. Si el schema los marca de otra forma, ajusta el acceso a `tokens`.

**Verify:**
- Con la API corriendo, `npm run dev` y abre `/login`.
- Con la contraseña de un usuario de prueba (`inventario-demo`), entras y llegas a `/`, que todavía es el smoke test. En DevTools → Application → Cookies, `access` y `refresh` tienen la marca **HttpOnly** y `SameSite=Lax`.
- Una contraseña mala muestra "El email o la contraseña no son correctos." y el email sigue escrito.
- `seller.ipc01@example.com`, que está desactivado, muestra el mismo mensaje.
- Once intentos rápidos muestran "Demasiados intentos…".
- Con Django apagado: "No se pudo conectar con la API.".
- `/login?next=/\malo.com` y `/login?next=/salir`: después de entrar, terminas en `/`.
- `npm run lint` y `npm run build` pasan.

**Suggested commit name:** `feat: add login page and Server Action`

### Step 3 — Agregar `proxy.ts`: refresco, cookies y redirecciones

El proxy corre antes que cualquier página, layout o Server Action (*"Proxy executes before routes are rendered"*, [proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy); local: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, línea 15), y puede leer y escribir cookies. Por eso es el único lugar donde se puede renovar el token antes de que el render lo use.

En cada request, el proxy:

1. **Decide si refresca.** Si al access le quedan menos de 30 segundos, falta, o no se puede leer, y hay refresh, llama a `/auth/token/refresh/`.
2. **Interpreta la respuesta:**
   - **200:** usa el par nuevo;
   - **401:** el refresh ya no sirve (vencido, en la blacklist o usuario inactivo), así que borra las dos cookies;
   - **cualquier otra cosa** (503, falla de red): conserva las cookies. No prueba que la sesión haya muerto, solo que la API no contestó.
3. **Redirige, solo en los `GET`:**
   - sin sesión y fuera de `/login` y `/salir`, a `/login?next=<ruta>`;
   - con sesión en `/login`, a `/`.
4. **Escribe las cookies dos veces:** en el **request**, para que este mismo render lea el token nuevo, y en la **respuesta**, para que el navegador lo guarde.
5. **Pasa la ruta actual al render** en el header `x-current-path` (lo usa el paso 4).

**What we'll implement:**
- Crear `proxy.ts` en la raíz del proyecto con:
  - el tipo `TokenRefreshResult` (`refreshed` con los tokens, `rejected`, `unavailable`);
  - `tokenRefreshesByRefreshToken`, un `Map` a nivel de módulo de refresh token → promesa del refresh;
  - `proxy(request)`, que sigue los cinco pasos de arriba y no hace nada en `/salir`;
  - `withTokenCookieChanges(response, refreshedTokens, isRefreshTokenRejected)`, que escribe o borra las cookies en una respuesta;
  - `refreshTokensSharingConcurrentRequests(refreshToken)`, que reutiliza un refresh en curso o reciente, guarda los resultados `refreshed` y `rejected` por 30 segundos y descarta enseguida los `unavailable`;
  - `requestTokenRefreshFromApi(refreshToken)`, que nunca lanza: convierte la respuesta de la API, o su falla, en un `TokenRefreshResult`;
  - `config.matcher`, que excluye `_next/static`, `_next/image`, `favicon.ico` y las imágenes.

`proxy.ts` (nuevo)
```diff
+import { NextResponse, type NextRequest } from "next/server";
+
+import { createApiClient } from "@/lib/api/client";
+import { currentPathRequestHeaderName } from "@/lib/local-redirect-path";
+import {
+  accessTokenCookieName,
+  deleteTokenCookies,
+  isAccessTokenFresh,
+  refreshTokenCookieName,
+  writeTokenCookies,
+  type TokenPair,
+} from "@/lib/session";
+
+type TokenRefreshResult =
+  | { outcome: "refreshed"; tokens: TokenPair }
+  // 401: the refresh token expired, was blacklisted, or the user was deactivated.
+  | { outcome: "rejected" }
+  // Network error or any other status: the API didn't answer, the session may still be fine.
+  | { outcome: "unavailable" };
+
+// Requests that arrive together with the same refresh token (a navigation plus the prefetches
+// of its links) share one refresh. Otherwise the first would rotate the token and the rest
+// would get 401 for reusing it, logging the user out at random.
+// Module state works only because one Node.js process serves the whole app (see below).
+const tokenRefreshesByRefreshToken = new Map<string, Promise<TokenRefreshResult>>();
+const settledRefreshRetentionMilliseconds = 30_000;
+
+const pathsReachableWithoutSession = ["/login", "/salir"];
+
+export async function proxy(request: NextRequest) {
+  const { pathname, search } = request.nextUrl;
+
+  // /salir deletes the cookies itself: refreshing first would only rotate a token it's dropping.
+  if (pathname === "/salir") return NextResponse.next();
+
+  let accessToken = request.cookies.get(accessTokenCookieName)?.value;
+  const refreshToken = request.cookies.get(refreshTokenCookieName)?.value;
+  let refreshedTokens: TokenPair | null = null;
+  let isRefreshTokenRejected = false;
+
+  // Missing, about to expire, or unreadable (a garbage cookie): all mean "refresh".
+  if (!isAccessTokenFresh(accessToken) && refreshToken) {
+    const refreshResult = await refreshTokensSharingConcurrentRequests(refreshToken);
+    if (refreshResult.outcome === "refreshed") {
+      refreshedTokens = refreshResult.tokens;
+      accessToken = refreshResult.tokens.access;
+    } else if (refreshResult.outcome === "rejected") {
+      isRefreshTokenRejected = true;
+      accessToken = undefined;
+    }
+  }
+
+  const hasSession =
+    isAccessTokenFresh(accessToken) || (Boolean(refreshToken) && !isRefreshTokenRejected);
+
+  // Only navigations are redirected. A Server Action is a POST to the page's route, and a 307
+  // would make the browser repeat that POST against /login. The action finds out on its own:
+  // the API answers 401.
+  const isNavigation = request.method === "GET";
+  if (isNavigation && !hasSession && !pathsReachableWithoutSession.includes(pathname)) {
+    const loginUrl = new URL("/login", request.nextUrl);
+    loginUrl.searchParams.set("next", pathname + search);
+    return withTokenCookieChanges(
+      NextResponse.redirect(loginUrl),
+      refreshedTokens,
+      isRefreshTokenRejected,
+    );
+  }
+  if (isNavigation && hasSession && pathname === "/login") {
+    return withTokenCookieChanges(
+      NextResponse.redirect(new URL("/", request.nextUrl)),
+      refreshedTokens,
+      isRefreshTokenRejected,
+    );
+  }
+
+  // On the request: so cookies() in this very render reads the new tokens.
+  if (refreshedTokens) {
+    request.cookies.set(accessTokenCookieName, refreshedTokens.access);
+    request.cookies.set(refreshTokenCookieName, refreshedTokens.refresh);
+  } else if (isRefreshTokenRejected) {
+    request.cookies.delete(accessTokenCookieName);
+    request.cookies.delete(refreshTokenCookieName);
+  }
+  const forwardedRequestHeaders = new Headers(request.headers);
+  // set, not append: overwrites anything the browser sent under the same name.
+  forwardedRequestHeaders.set(currentPathRequestHeaderName, pathname + search);
+
+  // On the response: so the browser keeps them for the next request.
+  return withTokenCookieChanges(
+    NextResponse.next({ request: { headers: forwardedRequestHeaders } }),
+    refreshedTokens,
+    isRefreshTokenRejected,
+  );
+}
+
+function withTokenCookieChanges(
+  response: NextResponse,
+  refreshedTokens: TokenPair | null,
+  isRefreshTokenRejected: boolean,
+): NextResponse {
+  if (refreshedTokens) writeTokenCookies(response.cookies, refreshedTokens);
+  else if (isRefreshTokenRejected) deleteTokenCookies(response.cookies);
+  return response;
+}
+
+function refreshTokensSharingConcurrentRequests(refreshToken: string): Promise<TokenRefreshResult> {
+  const refreshAlreadyStarted = tokenRefreshesByRefreshToken.get(refreshToken);
+  if (refreshAlreadyStarted) return refreshAlreadyStarted;
+
+  const refresh = requestTokenRefreshFromApi(refreshToken);
+  tokenRefreshesByRefreshToken.set(refreshToken, refresh);
+  void refresh.then((result) => {
+    if (result.outcome === "unavailable") {
+      // Don't keep a failure: the next request should try again, not reuse the error.
+      tokenRefreshesByRefreshToken.delete(refreshToken);
+    } else {
+      // Keep it a little: requests that arrive just after the refresh reuse its result.
+      setTimeout(
+        () => tokenRefreshesByRefreshToken.delete(refreshToken),
+        settledRefreshRetentionMilliseconds,
+      );
+    }
+  });
+  return refresh;
+}
+
+async function requestTokenRefreshFromApi(refreshToken: string): Promise<TokenRefreshResult> {
+  try {
+    const { data: tokens, response } = await createApiClient().POST("/api/v1/auth/token/refresh/", {
+      body: { refresh: refreshToken },
+    });
+    if (tokens) return { outcome: "refreshed", tokens: { access: tokens.access, refresh: tokens.refresh } };
+    if (response.status === 401) return { outcome: "rejected" };
+    console.error(`La API respondió ${response.status} al refrescar el token.`);
+    return { outcome: "unavailable" };
+  } catch (error) {
+    console.error("No se pudo conectar con la API para refrescar el token:", error);
+    return { outcome: "unavailable" };
+  }
+}
+
+export const config = {
+  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
+};
```

Qué notar:

- **`{ request: { headers } }` y no `{ headers }`.** `NextResponse.next({ request: { headers } })` *"forwards `newHeaders` upstream to the target page, route, or server action, and does not expose them to the client"*. En cambio, `NextResponse.next({ headers })` manda headers **al navegador**, y la documentación dice que *"This is **NOT** good practice"*, porque un header como `Content-Type` puede romper los Server Actions ([NextResponse — `next()`](https://nextjs.org/docs/app/api-reference/functions/next-response#next); local: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-response.md`, líneas 141–161). Las cookies son headers comunes: `Cookie` en el request y `Set-Cookie` en la respuesta ([proxy.js — Using Cookies](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#using-cookies), línea 346).
- **Qué falla si falta una de las dos escrituras.** Sin la del request, esta página renderiza con el access vencido, la API responde 401 y el usuario termina fuera. Sin la de la respuesta, el próximo request llega con el refresh viejo, que la API ya anuló, y el usuario también termina fuera.
- **Los Server Actions también pasan por aquí.** No son rutas aparte: *"They are handled as POST requests to the route where they are used"* ([proxy.js — Execution order](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#execution-order), líneas 249–251). Un clic en un botón después de 20 minutos quietos también refresca, y el action lee el token nuevo.
- **Por qué no se redirigen los `POST`.** `NextResponse.redirect` usa **307** por defecto (`node_modules/next/dist/server/web/spec-extension/response.js`, línea 95), y un 307 conserva el método: *"meaning the request method is preserved"* (`redirect.md`, línea 215). El navegador repetiría el `POST` del action contra `/login`, que no tiene ese action, y fallaría. Si el `POST` pasa sin sesión, el action llama a la API, recibe 401 y redirige con `redirect()`, que sí sabe manejar un action.
- **Por qué no se borran las cookies con un 503.** Si la API se está reiniciando, borrarlas sacaría al usuario sin motivo. Solo un 401 demuestra que el refresh ya no sirve. Por la misma razón, el `Map` no guarda un `unavailable`: si lo guardara, todos los requests de ese medio minuto reusarían el error en vez de reintentar.
- **Un token ilegible no tumba la app.** Si decodificar `exp` lanzara una excepción, fallaría **cada** request, incluido `/login`, y el usuario quedaría atrapado hasta borrar las cookies a mano. `readTokenExpiry` devuelve `null`, el proxy lo trata como vencido y refresca, y si el refresh tampoco sirve, la API responde 401 y se borran las cookies.
- **Un chequeo optimista, no seguro.** El proxy no verifica la firma, así que un token editado con `exp` en 2099 pasa. No importa: los datos salen de la API, que sí verifica la firma y responde 401. Lo que alcanza a verse es el marco de la sidebar y un skeleton, que no tienen datos de nadie. La guía distingue los chequeos *optimistic* (desde la cookie, rápidos) de los *secure* (contra la fuente de verdad) ([Authentication — Authorization](https://nextjs.org/docs/app/guides/authentication#authorization), líneas 1017–1018 y 1033).
- **El margen de 30 segundos es un tema de experiencia, no de seguridad.** Si el proxy dejara pasar un token al que le queda 1 segundo, vencería mientras el render llama a la API, la API respondería 401 y el usuario perdería la sesión con un refresh que le servía por días.
- **El `Map` a nivel de módulo va contra una advertencia de la documentación:** *"you should not attempt relying on shared modules or globals"*, porque el proxy puede *"in optimized cases [be] deployed to your CDN"* (`proxy.md`, líneas 17–21). En una CDN o con varias instancias habría un `Map` por entorno, los refrescos concurrentes caerían en instancias distintas y volvería el logout aleatorio. Aquí funciona porque un solo proceso de Node.js atiende todo en local. Es un **límite conocido**: un despliegue con varias instancias necesitaría un almacén compartido, como Redis.

**Known uncertainty.**
- **¿El `Map` es uno solo?** Se asume que el módulo del proxy se evalúa una vez por proceso, tanto en `next dev` como en `next start`. Para comprobarlo, agrega temporalmente `console.log("proxy module loaded")` al principio del archivo: debe salir una vez al arrancar, o una vez por recarga en desarrollo, y no una vez por request. Si sale en cada request, la deduplicación no funciona. Anótalo y sigue: en local el efecto es un logout ocasional durante la prueba de refresco.
- **`request.cookies.set` cambia `request.headers`.** El diff asume que `RequestCookies` reescribe el header `cookie` del request, así que `new Headers(request.headers)` ya trae los valores nuevos. Si la prueba de refresco muestra que el render sigue leyendo el token viejo, arma el header `cookie` a mano en `forwardedRequestHeaders`.
- **`server-only`:** ver el paso 1. El proxy importa `lib/api/client.ts`, que también lo usa.

**Verify:**
- Sin sesión, abre `/`: terminas en `/login?next=%2F`. Al entrar, vuelves a `/`.
- Con sesión, abre `/login`: terminas en `/`.
- En DevTools → Application, borra solo la cookie `access` y recarga: aparece una `access` nueva y la `refresh` también cambia.
- Cambia el valor de `access` por `abc` y recarga: la página carga y la cookie se reemplaza. No hay crash.
- Cambia el valor de `refresh` por `abc` y borra `access`: terminas en `/login` sin cookies.
- `npm run lint` y `npm run build` pasan.

**Suggested commit name:** `feat: refresh tokens and guard routes in proxy`

### Step 4 — Cerrar la sesión vencida: `/salir` y el caso 401

La API puede responder 401 aunque el proxy haya dejado pasar el request, por ejemplo cuando un encargado desactiva a alguien. La página tiene que borrar las cookies, y no puede: es render. Redirigir directo a `/login` haría un loop, porque el proxy vería un access que todavía parece válido y mandaría al usuario de vuelta a `/`.

El arreglo es una ruta que sí puede borrar cookies. `.delete` y `.set` solo funcionan *"In a Server Function or Route Handler"* (`cookies.md`, líneas 71–74). Durante el render, lo único que se puede hacer es un `redirect()`, que llega como un `GET`, así que `/salir` es un **Route Handler con `GET`**.

**What we'll implement:**
- Crear `app/(auth)/salir/route.ts` con `GET(request)`: borra las dos cookies y redirige a `/login`, con `next` si es una ruta local válida.
- En `lib/api/errors.tsx`:
  - agregar `redirectToEndExpiredSession()`: lee `x-current-path` con `headers()` y redirige a `/salir?next=<ruta codificada>`;
  - hacer `renderApiErrorForPage` asíncrona, y que un 401 llame a `redirectToEndExpiredSession()`.

`app/(auth)/salir/route.ts` (nuevo)
```diff
+import { NextResponse, type NextRequest } from "next/server";
+
+import { toSafeLocalRedirectPath } from "@/lib/local-redirect-path";
+import { deleteTokenCookies } from "@/lib/session";
+
+/** Where a 401 found while rendering ends up: pages can't delete cookies, a Route Handler can. */
+export function GET(request: NextRequest) {
+  const loginUrl = new URL("/login", request.nextUrl);
+  const pathAfterLogin = toSafeLocalRedirectPath(request.nextUrl.searchParams.get("next"));
+  if (pathAfterLogin !== "/") loginUrl.searchParams.set("next", pathAfterLogin);
+
+  const response = NextResponse.redirect(loginUrl);
+  deleteTokenCookies(response.cookies);
+  return response;
+}
```

`lib/api/errors.tsx`
```diff
-import { notFound } from "next/navigation";
+import { headers } from "next/headers";
+import { notFound, redirect } from "next/navigation";
 import type { ReactElement } from "react";
 
 import { PermissionDenied } from "@/components/permission-denied";
+import { currentPathRequestHeaderName } from "@/lib/local-redirect-path";
 …
 /**
  * For Server Components, after checking `!response.ok`.
- * Call it outside any try/catch: notFound() works by throwing, and a catch would swallow it.
+ * Call it outside any try/catch: notFound() and redirect() work by throwing, and a catch would
+ * swallow them.
  */
-export function renderApiErrorForPage(response: Response): ReactElement {
+export async function renderApiErrorForPage(response: Response): Promise<ReactElement> {
+  if (response.status === 401) await redirectToEndExpiredSession();
   if (response.status === 404) notFound();
   if (response.status === 403) return <PermissionDenied />;
   throw new Error(`La API respondió ${response.status}.`);
 }
+
+/**
+ * The API rejected the token while rendering: send the user through /salir, which deletes the
+ * cookies, and back to this page after logging in again.
+ */
+export async function redirectToEndExpiredSession(): Promise<never> {
+  const currentPath = (await headers()).get(currentPathRequestHeaderName) ?? "/";
+  redirect(`/salir?next=${encodeURIComponent(currentPath)}`);
+}
```

Las fases siguientes lo llamarán con `await`:

```tsx
if (!response.ok) return await renderApiErrorForPage(response);
```

Qué notar:

- **Por qué un Route Handler y no otra cosa:**
  - Una **página** (`salir/page.tsx`) es render, y en render no se escriben cookies.
  - Un **Client Component** no puede borrarlas: `document.cookie` ni siquiera ve una cookie `httpOnly`.
  - **Llamar a un Server Action desde el render** no lo convierte en Server Action: corre dentro del mismo render, y *"Next.js explicitly prevents setting cookies or triggering cache revalidation within render methods"* ([Data Security — Avoiding side-effects during rendering](https://nextjs.org/docs/app/guides/data-security#avoiding-side-effects-during-rendering), línea 569).
  - El **proxy** también podría atender `/salir`, porque puede borrar cookies en la respuesta. Se eligió un Route Handler para que el proxy se ocupe solo del refresco y de las redirecciones.
- **De dónde sale la ruta actual.** En un Server Component no hay ninguna API que la entregue: `usePathname()` es un hook de cliente, `window` no existe en el servidor y `Referer` es la página **anterior**, que además puede faltar. La documentación indica pasar información del proxy a la app con headers (*"To pass information from Proxy to your application, use headers…"*, `proxy.md`, línea 21). El proxy pone `x-current-path` en **cada** request que deja pasar, y la lee [`headers()`](https://nextjs.org/docs/app/api-reference/functions/headers).
- **`encodeURIComponent`.** Sin codificar, en `/salir?next=/tiendas/3?pagina=2` el `?pagina=2` se mezclaría con el query de `/salir`.
- **`renderApiErrorForPage` pasa a ser `async`** porque `headers()` es asíncrona. Todavía nadie la llama, así que no hay que cambiar ningún uso.
- **Riesgo aceptado: un link a `/salir` cierra la sesión.** `/salir` responde a un `GET` con un efecto, así que un link externo puede desconectar al usuario. El atacante no lee nada ni actúa en su nombre: solo lo obliga a volver a iniciar sesión. Decidiste aceptarlo por su impacto bajo.

**Known uncertainty.** Desde una página, `redirect("/salir…")` lleva al navegador a un Route Handler que responde otro redirect. Se espera que el router de Next.js lo siga hasta `/login`, quizás con una navegación completa. Si se queda en blanco o muestra un error, cambia el `redirect` por uno a una URL absoluta construida con el host del request, o ejecuta el chequeo del paso 5 como se describe en su Verify. Desde un **Server Action** (las fases siguientes), si el router no sigue el redirect hacia el Route Handler, el action puede hacer lo mismo por su cuenta, porque un Server Function sí puede borrar cookies: `deleteTokenCookies(await cookies())` y `redirect("/login?next=…")`.

**Verify:**
- Con sesión, abre `/salir?next=/tiendas`: terminas en `/login?next=%2Ftiendas` sin cookies.
- Abre `/salir?next=//malo.com`: terminas en `/login`, sin `next`.
- `npm run lint` y `npm run build` pasan. El caso 401 de una página se prueba en el paso 5.

**Suggested commit name:** `feat: end expired sessions through /salir`

### Step 5 — Crear el Data Access Layer: `getCurrentUser()` y `can()`

Varias partes de cada página necesitan al usuario: el menú, la navegación y la página misma. Si cada una llamara a la API por su cuenta, serían tres requests iguales, y cada una tendría que acordarse de manejar el 401. La guía recomienda centralizar ese acceso en un Data Access Layer, en un archivo propio (*"create a separate file for your DAL"*, [Authentication — Creating a DAL](https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal), línea 1137).

**What we'll implement:**
- Agregar a `lib/api/client.ts` la función `createApiClientForCurrentRequest()`: lee la cookie `access` con `cookies()` y crea el cliente con ese token.
- Crear `lib/auth.ts`, marcado `import "server-only"`, con:
  - el tipo `CurrentUser`, que solo toma de `User` los campos `id`, `email`, `first_name`, `last_name`, `role`, `permissions` y `stores`;
  - `getCurrentUser()`, envuelta en `cache()` de React: llama a `GET /api/v1/auth/me/`, manda un 401 a `redirectToEndExpiredSession()`, lanza con cualquier otro error y devuelve un `CurrentUser`;
  - `can(user, permission)`, que revisa si `permission` está en `user.permissions`.

`lib/api/client.ts`
```diff
 import "server-only";
 
+import { cookies } from "next/headers";
 import createClient from "openapi-fetch";
 
+import { accessTokenCookieName } from "@/lib/session";
+
 import type { paths } from "./schema";
 …
     headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
   });
 }
+
+/**
+ * The client for whoever made this request, with the access token from their cookie.
+ * The proxy has already refreshed it, so this is the token the API should accept.
+ */
+export async function createApiClientForCurrentRequest() {
+  const cookieStore = await cookies();
+  return createApiClient(cookieStore.get(accessTokenCookieName)?.value);
+}
```

`lib/auth.ts` (nuevo)
```diff
+import "server-only";
+
+import { cache } from "react";
+
+import { createApiClientForCurrentRequest } from "@/lib/api/client";
+import { redirectToEndExpiredSession } from "@/lib/api/errors";
+import type { components } from "@/lib/api/schema";
+
+type User = components["schemas"]["User"];
+
+/** Only what the UI uses: nothing else from /auth/me/ reaches components. */
+export type CurrentUser = Pick<
+  User,
+  "id" | "email" | "first_name" | "last_name" | "role" | "permissions" | "stores"
+>;
+
+/**
+ * The signed-in user, from the API. Wrapped in cache(): the layout, the navigation and the page
+ * share one /auth/me/ call per render. In a Server Action cache() does nothing, so call it once
+ * there and reuse the result.
+ */
+export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
+  const api = await createApiClientForCurrentRequest();
+  const { data: user, response } = await api.GET("/api/v1/auth/me/");
+  if (response.status === 401) await redirectToEndExpiredSession();
+  if (!user) throw new Error(`La API respondió ${response.status} en /auth/me/.`);
+
+  return {
+    id: user.id,
+    email: user.email,
+    first_name: user.first_name,
+    last_name: user.last_name,
+    role: user.role,
+    permissions: user.permissions,
+    stores: user.stores,
+  };
+});
+
+/** Optimistic: decides what to show. The API still authorizes every call. */
+export function can(user: CurrentUser, permission: string): boolean {
+  return user.permissions.includes(permission);
+}
```

Qué notar:

- **Cuánto dura `cache()`.** Deduplica *"within a React render pass. Server Actions and Route Handlers are not part of a render pass, so the wrapper does nothing and every call runs the function"* (`authentication.md`, línea 1181). Y *"`React.cache` is scoped to the current request only"* ([Fetching Data — Reusing data with `React.cache`](https://nextjs.org/docs/app/getting-started/fetching-data#reusing-data-with-reactcache); local: `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`, línea 604). En una navegación, tres componentes comparten **una** llamada. En la siguiente navegación, `/auth/me/` se vuelve a llamar, y eso conviene: si desactivan al usuario, la próxima navegación lo nota.
- **Next.js no guarda la identidad.** La sesión vive en las cookies del navegador. Next.js no recuerda nada del usuario entre requests: en cada uno le pregunta a Django.
- **Un tipo angosto.** `CurrentUser` deja fuera `is_staff` y `date_joined`, que la UI no usa. Si un día alguien pasa el usuario a un Client Component, solo viaja al navegador lo necesario (la guía lo llama Data Transfer Object, [Authentication — Using DTOs](https://nextjs.org/docs/app/guides/authentication#using-data-transfer-objects-dto)).
- **`can()` es para mostrar u ocultar,** no para proteger. La que autoriza es la API ([docs/roadmap.md:79](docs/roadmap.md#L79)).
- **El módulo de sesión y el DAL son cosas distintas.** `lib/session.ts` sabe de cookies y no llama a la API; lo usa el proxy, que tiene que ser liviano. `lib/auth.ts` llama a la API durante el render. Si estuvieran juntos, el proxy cargaría con `cache()`, el cliente y el manejo del 401.

**Verify:**
- `npm run lint` y `npm run build` pasan. El paso 6 usa estas funciones.
- **Prueba temporal del caso 401.** En el `app/page.tsx` de hoy, agrega un componente dentro del `<Suspense>` que haga `await getCurrentUser()` y muestre el email. Con sesión, se ve el email. Desactiva tu usuario de prueba desde el admin de Django y recarga: terminas en `/login` sin cookies y sin `next`, porque `/salir` no agrega `next` cuando vale `/` (el destino por defecto). Con otra ruta, por ejemplo `/?x=1`, sí lo conserva. Vuelve a activarlo y borra la prueba.

**Suggested commit name:** `feat: add data access layer for the current user`

### Step 6 — Armar el shell y la página de Inicio

El shell envuelve todas las páginas menos el login: la sidebar con la navegación y el menú del usuario. Va en `app/(app)/layout.tsx`. Ese layout solo envuelve lo que está dentro de `(app)`, así que `/login`, que está en `(auth)`, queda fuera.

La regla que manda en este paso: con Cache Components, *"reading `cookies()` outside a boundary is a build error"*, y la promesa del usuario se crea *"inside the Suspense boundary, not at the top of a layout"* ([Authentication with Cache Components — Step 2 y Step 3](https://nextjs.org/docs/app/guides/authentication-with-cache-components#step-2-show-the-user-without-blocking-the-page); local: `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`, líneas 117 y 164). Por eso el layout **no** llama a `getCurrentUser()`. El marco de la sidebar es estático y entra al static shell. Lo que depende del usuario (la navegación y el menú) va en componentes propios, cada uno dentro de su `<Suspense>`.

**What we'll implement:**
- Agregar los componentes `sidebar` y `skeleton` de shadcn.
- Crear `app/(app)/layout.tsx` con `AppShellLayout`: `SidebarProvider`, `AppSidebar` y un `SidebarInset` con un header que tiene el `SidebarTrigger`, más el contenido de la página.
- Crear `components/app-sidebar.tsx` con `AppSidebar`: el título de la app arriba, `AppNavigation` en el contenido y `UserMenu` en el pie, cada uno dentro de `<Suspense>` con un skeleton.
- Crear `components/app-navigation.tsx` con:
  - `navigationItems`, la lista de ítems con `href`, `label` y `requiredPermission`; en esta fase solo tiene "Inicio", que no pide permiso;
  - `AppNavigation`, que muestra los ítems que el usuario puede ver según `can()`.
- Crear `components/user-menu.tsx` con `UserMenu`: el nombre del usuario (o su email si no tiene nombre) y su rol en español, o "Sin rol asignado".
- Crear `app/(app)/page.tsx` con `HomePage` y su `metadata` ("Inicio"):
  - el título "Inicio" fuera de `<Suspense>`;
  - `HomeGreeting` dentro: un saludo y, si el usuario no tiene tiendas, el aviso "Tu cuenta no tiene tiendas asignadas. Pídele a tu encargado que te asigne una.".
- Borrar `app/page.tsx`, el smoke test.

```bash
npx shadcn@latest add sidebar skeleton
git rm app/page.tsx
```

`app/(app)/layout.tsx` (nuevo)
```diff
+import { AppSidebar } from "@/components/app-sidebar";
+import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
+
+// No await here: reading the session at the top of a layout fails the build with Cache
+// Components. What depends on the user streams in behind <Suspense> inside AppSidebar.
+export default function AppShellLayout({ children }: LayoutProps<"/">) {
+  return (
+    <SidebarProvider>
+      <AppSidebar />
+      <SidebarInset>
+        <header className="flex h-12 items-center border-b px-4">
+          <SidebarTrigger />
+        </header>
+        <div className="flex flex-1 flex-col p-6">{children}</div>
+      </SidebarInset>
+    </SidebarProvider>
+  );
+}
```

`components/app-sidebar.tsx` (nuevo)
```diff
+import { Suspense } from "react";
+
+import { AppNavigation } from "@/components/app-navigation";
+import { Skeleton } from "@/components/ui/skeleton";
+import {
+  Sidebar,
+  SidebarContent,
+  SidebarFooter,
+  SidebarGroup,
+  SidebarGroupContent,
+  SidebarHeader,
+} from "@/components/ui/sidebar";
+import { UserMenu } from "@/components/user-menu";
+
+export function AppSidebar() {
+  return (
+    <Sidebar>
+      <SidebarHeader>
+        <span className="px-2 py-1 font-semibold">Simulador de Cadena de Tiendas</span>
+      </SidebarHeader>
+      <SidebarContent>
+        <SidebarGroup>
+          <SidebarGroupContent>
+            <Suspense fallback={<Skeleton className="h-8 w-full" />}>
+              <AppNavigation />
+            </Suspense>
+          </SidebarGroupContent>
+        </SidebarGroup>
+      </SidebarContent>
+      <SidebarFooter>
+        <Suspense fallback={<Skeleton className="h-20 w-full" />}>
+          <UserMenu />
+        </Suspense>
+      </SidebarFooter>
+    </Sidebar>
+  );
+}
```

`components/app-navigation.tsx` (nuevo)
```diff
+import type { Route } from "next";
+import Link from "next/link";
+
+import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
+import { can, getCurrentUser } from "@/lib/auth";
+
+type NavigationItem = {
+  href: Route;
+  label: string;
+  /** null: everyone who is signed in sees it. */
+  requiredPermission: string | null;
+};
+
+// Each phase adds its pages here, with the permission that unlocks them.
+const navigationItems: NavigationItem[] = [{ href: "/", label: "Inicio", requiredPermission: null }];
+
+export async function AppNavigation() {
+  const user = await getCurrentUser();
+  const visibleNavigationItems = navigationItems.filter(
+    (item) => item.requiredPermission === null || can(user, item.requiredPermission),
+  );
+
+  return (
+    <SidebarMenu>
+      {visibleNavigationItems.map((item) => (
+        <SidebarMenuItem key={item.href}>
+          <SidebarMenuButton asChild>
+            <Link href={item.href}>{item.label}</Link>
+          </SidebarMenuButton>
+        </SidebarMenuItem>
+      ))}
+    </SidebarMenu>
+  );
+}
```

`components/user-menu.tsx` (nuevo)
```diff
+import { getCurrentUser } from "@/lib/auth";
+import { roleNames, spanishNameOrCode } from "@/lib/labels";
+
+export async function UserMenu() {
+  const user = await getCurrentUser();
+  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
+  const roleName = user.role ? spanishNameOrCode(roleNames, user.role) : "Sin rol asignado";
+
+  return (
+    <div className="flex flex-col gap-2 px-2 py-1">
+      <div>
+        <p className="truncate text-sm font-medium">{fullName}</p>
+        <p className="text-xs text-muted-foreground">{roleName}</p>
+      </div>
+    </div>
+  );
+}
```

`app/(app)/page.tsx` (nuevo)
```diff
+import type { Metadata } from "next";
+import { Suspense } from "react";
+
+import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
+import { Skeleton } from "@/components/ui/skeleton";
+import { getCurrentUser } from "@/lib/auth";
+
+export const metadata: Metadata = { title: "Inicio" };
+
+// Every role lands here in Phase 1. Phase 2 sends sellers to their store.
+export default function HomePage() {
+  return (
+    <main className="flex flex-col gap-4">
+      <h1 className="text-2xl font-semibold">Inicio</h1>
+      <Suspense fallback={<Skeleton className="h-24 w-full max-w-md" />}>
+        <HomeGreeting />
+      </Suspense>
+    </main>
+  );
+}
+
+async function HomeGreeting() {
+  // Same render pass as AppNavigation and UserMenu: cache() makes it one /auth/me/ call.
+  const user = await getCurrentUser();
+  const firstNameOrEmail = user.first_name || user.email;
+
+  if (user.stores.length === 0) {
+    return (
+      <Card className="max-w-md">
+        <CardHeader>
+          <CardTitle>Hola, {firstNameOrEmail}</CardTitle>
+          <CardDescription>
+            Tu cuenta no tiene tiendas asignadas. Pídele a tu encargado que te asigne una.
+          </CardDescription>
+        </CardHeader>
+      </Card>
+    );
+  }
+  return <p>Hola, {firstNameOrEmail}. Las pantallas de tus tiendas llegan en las próximas fases.</p>;
+}
```

`app/page.tsx` (se borra)
```diff
-import { Suspense } from "react";
-
-import { createApiClient } from "@/lib/api/client";
-…
-  return <p role="status">{apiHealthCheckMessages[healthCheckResult]}</p>;
-}
```

Qué notar:

- **El smoke test se borra en el mismo paso** en que nace `app/(app)/page.tsx`. Los dos resuelven a `/`, y *"Routes in different groups should not resolve to the same URL path"* (`route-groups.md`, línea 31). El ejemplo de la documentación usa dos grupos, pero un archivo fuera de grupo choca igual.
- **La trampa: `await getCurrentUser()` arriba del layout.** Es lo más natural de escribir, y con `cacheComponents: true` hace fallar `next build`. Antes de Cache Components funcionaba, pero bloqueaba toda la página hasta que respondiera `/auth/me/`.
- **Un usuario sin rol entra.** Ve "Sin rol asignado" en el menú, solo "Inicio" en la sidebar y el aviso de tiendas. La API devuelve `stores: []` cuando no hay rol.
- **La navegación depende del usuario** aunque hoy tenga un solo ítem sin permiso, porque las fases siguientes agregan ítems con permiso. Gracias a `cache()`, no cuesta una llamada extra.
- **Server Components que renderizan Client Components.** Los componentes de `components/ui/sidebar.tsx` son de cliente. Un Server Component puede renderizarlos y pasarles como `children` otros Server Components, incluso los async dentro de `<Suspense>`.
- **Sin estado de la sidebar en cookie.** La documentación de shadcn muestra cómo leer la cookie `sidebar_state` en el layout para recordar si estaba abierta. No lo hacemos: leer cookies arriba del layout es justo lo que Cache Components prohíbe.

**Known uncertainty.**
- **`npx shadcn@latest add sidebar`** también agrega o actualiza otros componentes (`sheet`, `tooltip`, `separator`, `input`) y un hook `use-mobile`. Si pregunta si sobrescribir `button` o `input`, revisa el diff antes de aceptar.
- **`LayoutProps<"/">`** se asume válido para el layout de un grupo que envuelve `/`. Si TypeScript no lo acepta, usa `{ children }: { children: React.ReactNode }`.
- **`Route` de `next`** se asume disponible para tipar `href`, con los typed routes que Next.js 16 genera. Si no existe, usa `string`.

**Verify:**
- `npm run dev`, inicia sesión con cada rol de prueba:
  - aparecen la sidebar, "Inicio", el nombre y el rol en español;
  - el marco de la sidebar aparece antes que el nombre, con un skeleton mientras tanto.
- Un usuario sin rol ve "Sin rol asignado" y el aviso de tiendas.
- `/login` se ve sin sidebar.
- En la terminal de la API, una navegación a `/` hace **una** llamada a `/api/v1/auth/me/`, no tres.
- `npm run lint` y `npm run build` pasan.

**Suggested commit name:** `feat: add app shell with sidebar and home page`

### Step 7 — Agregar el logout

El logout es la última de las cinco cosas: descartar. Es un **Server Action**, y eso importa por el botón "Atrás". El Client Cache del navegador reutiliza las páginas al ir atrás y adelante (*"Pages … are reused during browser back/forward navigation"*), pero se invalida con *"`cookies.set`, or `cookies.delete`"* ([Glossary — Client Cache](https://nextjs.org/docs/app/glossary#client-cache); local: `node_modules/next/dist/docs/01-app/04-glossary.md`, líneas 49–51). Al borrar las cookies desde el action, un "Atrás" en un computador compartido obliga al router a pedir la página al servidor, y el proxy, sin cookies, manda al siguiente vendedor al login.

**What we'll implement:**
- Crear `app/(app)/actions.ts` (`"use server"`) con `logOut()`:
  - manda el refresh a `POST /api/v1/auth/token/blacklist/`; si falla, solo lo registra con `console.error`;
  - borra las dos cookies **siempre**;
  - redirige a `/login`.
- En `components/user-menu.tsx`, agregar un `<form action={logOut}>` con el botón "Cerrar sesión".

`app/(app)/actions.ts` (nuevo)
```diff
+"use server";
+
+import { cookies } from "next/headers";
+import { redirect } from "next/navigation";
+
+import { createApiClient } from "@/lib/api/client";
+import { deleteTokenCookies, refreshTokenCookieName } from "@/lib/session";
+
+export async function logOut(): Promise<void> {
+  const cookieStore = await cookies();
+  const refreshToken = cookieStore.get(refreshTokenCookieName)?.value;
+
+  if (refreshToken) {
+    try {
+      const { response } = await createApiClient().POST("/api/v1/auth/token/blacklist/", {
+        body: { refresh: refreshToken },
+      });
+      if (!response.ok) {
+        console.error(`La API respondió ${response.status} al anular el refresh token.`);
+      }
+    } catch (error) {
+      console.error("No se pudo conectar con la API para anular el refresh token:", error);
+    }
+  }
+
+  // Always, even if the blacklist call failed: on a shared computer, the next person must not
+  // inherit this session.
+  deleteTokenCookies(cookieStore);
+  redirect("/login");
+}
```

`components/user-menu.tsx`
```diff
+import { logOut } from "@/app/(app)/actions";
+import { Button } from "@/components/ui/button";
 import { getCurrentUser } from "@/lib/auth";
 import { roleNames, spanishNameOrCode } from "@/lib/labels";
 …
         <p className="text-xs text-muted-foreground">{roleName}</p>
       </div>
+      <form action={logOut}>
+        <Button type="submit" variant="outline" size="sm" className="w-full">
+          Cerrar sesión
+        </Button>
+      </form>
     </div>
   );
 }
```

Qué notar:

- **La blacklist solo anula refresh tokens.** El access sigue siendo válido en la API hasta su `exp`, hasta 15 minutos más. No importa porque la cookie ya no existe, pero es la razón por la que borrar las cookies no es opcional.
- **Por qué dos tokens.** Un token que no se puede anular solo se limita con su duración. Si el único token durara 7 días, un ladrón podría usarlo 7 días. El diseño reparte el riesgo:

  | | Access | Refresh |
  | --- | --- | --- |
  | Viaja | En cada request a la API | Solo al refrescar y en el logout |
  | Dura | 15 minutos | 7 días |
  | ¿Se puede anular? | No | Sí, con la blacklist |
  | Si se lo roban | Sirve hasta 15 minutos | Sirve una vez, porque la rotación lo anula |

- **`<form action={logOut}>` en un Server Component** funciona incluso sin JavaScript: el navegador hace un `POST` común y `redirect()` responde un 303 (`redirect.md`, línea 12).
- **El `redirect()` está fuera del `try`,** por la misma razón que en el login.

**Verify:**
- Inicia sesión, navega y aprieta "Cerrar sesión": llegas a `/login` sin cookies.
- Aprieta "Atrás" en el navegador: terminas en `/login` y no ves la página anterior.
- Con Django apagado, "Cerrar sesión" igual te lleva a `/login` sin cookies, y la terminal muestra el error.
- `npm run lint` y `npm run build` pasan.

**Suggested commit name:** `feat: add logout Server Action`

### Step 8 — Agregar las páginas de carga, de error y 404

Sin estos archivos, un error inesperado o una URL que no existe muestran las páginas por defecto de Next.js, en inglés.

**What we'll implement:**
- Crear `app/(app)/loading.tsx` con `AppPageLoading`: un skeleton para el contenido mientras llega la página.
- Crear `app/error.tsx` (`"use client"`) con `AppError`: registra el error con `console.error` y muestra "No se pudo cargar esta página." con la línea "Puede que la API no esté disponible." y un botón "Reintentar" que llama a `retry()`.
- Crear `app/not-found.tsx` con `NotFoundPage`: "No encontramos esta página" y un link a Inicio.

`app/(app)/loading.tsx` (nuevo)
```diff
+import { Skeleton } from "@/components/ui/skeleton";
+
+export default function AppPageLoading() {
+  return (
+    <div className="flex flex-col gap-4">
+      <Skeleton className="h-8 w-48" />
+      <Skeleton className="h-24 w-full max-w-md" />
+    </div>
+  );
+}
```

`app/error.tsx` (nuevo)
```diff
+"use client"; // Error boundaries must be Client Components.
+
+import { useEffect } from "react";
+
+import { Button } from "@/components/ui/button";
+import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
+
+export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
+  useEffect(() => {
+    console.error(error);
+  }, [error]);
+
+  return (
+    <main className="flex flex-1 items-center justify-center px-4 py-16">
+      <Card className="w-full max-w-md">
+        <CardHeader>
+          <CardTitle>No se pudo cargar esta página.</CardTitle>
+          <CardDescription>Puede que la API no esté disponible.</CardDescription>
+        </CardHeader>
+        <CardContent>
+          <Button onClick={() => retry()}>Reintentar</Button>
+        </CardContent>
+      </Card>
+    </main>
+  );
+}
```

`app/not-found.tsx` (nuevo)
```diff
+import Link from "next/link";
+
+import { Button } from "@/components/ui/button";
+import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
+
+export default function NotFoundPage() {
+  return (
+    <main className="flex flex-1 items-center justify-center px-4 py-16">
+      <Card className="w-full max-w-md">
+        <CardHeader>
+          <CardTitle>No encontramos esta página</CardTitle>
+          <CardDescription>Puede que el enlace esté mal escrito o que la página ya no exista.</CardDescription>
+        </CardHeader>
+        <CardContent>
+          <Button asChild variant="outline">
+            <Link href="/">Ir a Inicio</Link>
+          </Button>
+        </CardContent>
+      </Card>
+    </main>
+  );
+}
```

Qué notar:

- **`error.tsx` va en la raíz y no en `(app)`.** Un `error.js` *"does **not** wrap the `layout.js` or `template.js` above it in the same segment"* ([error.js](https://nextjs.org/docs/app/api-reference/file-conventions/error); local: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, línea 96). Con la API caída, el primero que falla es `getCurrentUser()` dentro de la sidebar, que vive en `(app)/layout.tsx`. Un `(app)/error.tsx` no lo atraparía. En la raíz, envuelve al layout de `(app)` y también al login. Cuando falla, la página de error reemplaza al shell completo, lo que es razonable si la API no responde.
- **`retry` y no `reset`.** En esta versión, `error.js` recibe `retry`, que vuelve a pedir el contenido. `reset` solo limpia el estado sin volver a pedir nada, y la documentación dice *"In most cases, you should use `retry()` instead"* (`error.md`, líneas 117 y 155–157).
- **Un mensaje fijo, nunca `error.message`.** En producción, el mensaje de un error que viene de un Server Component llega saneado (Fase 0, paso 7). Elegiste mostrar un texto fijo y un botón.
- **`not-found.tsx` va en la raíz,** porque solo el raíz atiende las URLs que no existen: *"the root `app/not-found.js` … handle[s] any unmatched URLs for your whole application"* ([not-found.js](https://nextjs.org/docs/app/api-reference/file-conventions/not-found); local: `not-found.md`, línea 135). También atiende los `notFound()` de las páginas. Se muestra sin el shell.

**Known uncertainty.** El tipo de las props de `error.tsx` se escribió a mano (`error: unknown`, `retry: () => void`), como en el ejemplo de la documentación. Si Next.js genera un tipo propio para estas props, úsalo.

**Verify:**
- Abre `/no-existe`: ves "No encontramos esta página" en español.
- Con sesión, detén Django y recarga `/`: ves "No se pudo cargar esta página." con "Reintentar". Prende Django y aprieta "Reintentar": vuelve Inicio, sin recargar el navegador.
- `npm run lint` y `npm run build` pasan.

**Suggested commit name:** `feat: add Spanish error, not-found and loading pages`

### Step 9 — Actualizar el README y el roadmap

La tabla "Where each Next.js concept lives" apunta a `app/page.tsx`, que ya no existe, y no tiene los conceptos de esta fase. El roadmap, por su parte, todavía no menciona el límite de login compartido, que decidiste documentar.

**What we'll implement:**
- En `README.md`:
  - cambiar la fila del Server Component con `<Suspense>` para que apunte a `app/(app)/page.tsx`;
  - agregar filas para el proxy, los grupos de rutas, el Route Handler, los Server Actions con cookies, `useActionState`, el DAL con `cache()`, el shell que no bloquea, y las páginas de error, 404 y carga.
- En `docs/roadmap.md`, en "Backend changes worth considering", ampliar el punto **Throttling** con el límite de login de 10 por minuto y el arreglo posible.

`README.md`
```diff
 | Concept | Where to look |
 | --- | --- |
-| Server Component fetching data, streamed behind `<Suspense>` (Cache Components) | `app/page.tsx` |
+| Server Component fetching data, streamed behind `<Suspense>` (Cache Components) | `HomeGreeting` in `app/(app)/page.tsx` |
 …
+| Proxy: refreshing tokens, writing cookies on the request and the response, redirects | `proxy.ts` |
+| Route groups: pages with and without the shell | `app/(auth)/`, `app/(app)/` |
+| Server Action that sets cookies and redirects; `useActionState` form | `app/(auth)/login/actions.ts`, `app/(auth)/login/login-form.tsx` |
+| Server Action that deletes cookies (and invalidates the Client Cache) | `logOut` in `app/(app)/actions.ts` |
+| Route Handler that deletes cookies (pages can't) | `app/(auth)/salir/route.ts` |
+| Data Access Layer with React `cache()` | `lib/auth.ts` |
+| Passing data from Proxy to Server Components through a request header | `x-current-path` in `proxy.ts` and `lib/api/errors.tsx` |
+| Static shell with the user's data behind `<Suspense>` | `app/(app)/layout.tsx`, `components/app-sidebar.tsx` |
+| `error.tsx` with `retry`, root `not-found.tsx`, `loading.tsx` | `app/error.tsx`, `app/not-found.tsx`, `app/(app)/loading.tsx` |
```

`docs/roadmap.md`
```diff
 - **Throttling.** Every request comes from the Next.js server, so the API sees a single client.
   The anonymous limit (100 an hour) covers every login and token refresh. Each user is limited to
   1000 requests an hour, and a dashboard makes several API calls per page load. If you hit 429
   while developing, raise the rates in `dev.py`.
+  The login limit (10 a minute, `throttle_scope = "auth"`) is shared the same way: eleven login
+  attempts in a minute, from any number of people, return 429 to all of them. A fix is for
+  Next.js to forward the browser's IP (`X-Forwarded-For`) and for the API to trust it from the
+  Next.js server only (DRF's `NUM_PROXIES`).
```

**Known uncertainty.** Solo se leyeron las filas de la tabla del README hasta la del Server Component. Agrega las filas nuevas al final de la tabla, y si ya existe alguna parecida, actualízala en vez de duplicarla.

**Verify:** cada archivo de la tabla existe, y la sección del roadmap se lee bien.

**Suggested commit name:** `docs: document Phase 1 concepts and the shared login limit`

## Out of scope

- **Mandar al vendedor a su tienda al entrar.** Todos los roles ven el Inicio provisional; la Fase 2 agrega esa redirección cuando exista la página de la tienda.
- **Más ítems en la sidebar.** Solo "Inicio"; cada fase agrega los suyos a `navigationItems`.
- **Recordar si la sidebar estaba abierta.** Necesitaría leer una cookie en el layout.
- **Un almacén compartido para la deduplicación** (Redis o similar). La app corre en un solo proceso local.
- **Arreglar el límite de login compartido.** Es un cambio en la API; queda documentado en el roadmap.
- **Proteger `/salir` contra links externos.** Se aceptó como riesgo de impacto bajo.
- **Un menú desplegable de usuario.** El pie de la sidebar muestra nombre, rol y "Cerrar sesión" sin `dropdown-menu`.
- **Tests automáticos.** El roadmap no tiene por ahora.

## Verification

1. **Entra con cada rol de prueba** (contraseña `inventario-demo`). Ves la sidebar, "Inicio", tu nombre y tu rol en español. Prueba el login, el DAL y el shell.
2. **Contraseña mala, once intentos rápidos y `seller.ipc01@example.com`.** Ves "El email o la contraseña no son correctos.", luego "Demasiados intentos…", y la cuenta desactivada no entra. Prueba los errores del login.
3. **Sin sesión, abre `/tiendas`.** Terminas en `/login?next=%2Ftiendas`. Al entrar vuelves a `/tiendas`, que muestra la página 404 en español porque llega en la Fase 2. Prueba la redirección del proxy y `next`.
4. **`/login?next=//malo.com`, `/login?next=/\malo.com` y `/login?next=/salir`.** Después de entrar, terminas en `/`. Prueba la validación de `next`.
5. **En la consola del navegador, `document.cookie`** no muestra `access` ni `refresh`. Prueba `httpOnly`.
6. **Cerrar sesión y apretar "Atrás".** No ves datos: terminas en el login. Prueba el logout y la invalidación del Client Cache.
7. **Prueba de refresco:**
   - Agrega temporalmente `SIMPLE_JWT = {**SIMPLE_JWT, "ACCESS_TOKEN_LIFETIME": timedelta(minutes=1)}` al `config/settings/dev.py` de la API. No lo commitees.
   - Navega unos minutos con varias pestañas abiertas. Nunca te saca la sesión.
   - Haz la prueba corta: un token de un minuto refresca 60 veces por hora, y la API permite 100 requests anónimos por hora desde lo que ve como un solo cliente.

   Prueba el refresco, la escritura doble de cookies y la deduplicación.
8. **Desactiva tu usuario desde el admin de Django y navega.** Terminas en `/login`, con el `next` de la página donde estabas. Prueba el 401 durante el render y `/salir`.
9. **Con sesión, detén Django y navega.** Ves la página de error con "Reintentar", y tus cookies siguen ahí. Al prender Django y reintentar, sigues con sesión. Prueba que un 503 o una falla de red no cierran la sesión.
10. **`npm run lint` y `npm run build` pasan.** Prueba que nada lee cookies fuera de `<Suspense>` y que los tipos calzan.

## What you learned

### Un request sin token

**Question:** Hoy, si una página llamara a `/api/v1/auth/me/` con `createApiClient()` sin token, ¿qué respondería la API y por qué?
**Answer:** 401. Sin token, DRF deja `request.user` como `AnonymousUser`, `IsAuthenticated` lo rechaza, y como `JWTAuthentication` manda `WWW-Authenticate: Bearer`, la respuesta es 401 y no 403. El 401 significa "no sé quién eres"; el 403, "sé quién eres, pero no puedes".
**Source:** [DRF — How authentication is determined](https://www.django-rest-framework.org/api-guide/authentication/#how-authentication-is-determined) y [Unauthorized and Forbidden responses](https://www.django-rest-framework.org/api-guide/authentication/#unauthorized-and-forbidden-responses).

### Un 401 hoy y en la Fase 1

**Question:** ¿Qué ve hoy el usuario si una página recibe un 401 y llama a `renderApiErrorForPage`? ¿Qué debería pasar?
**Answer:** Hoy se lanza un error y ve la página de error por defecto de Next.js. En la Fase 1 hay que borrar la sesión: todo 401 pasa por una ruta que borra las cookies y redirige al login.
**Source:** `lib/api/errors.tsx`; `docs/roadmap.md`, "Session expired mid-render".

### La rotación de refresh tokens

**Question:** Dos requests llegan casi juntos con el mismo refresh token. ¿Qué responde la API a cada uno, y qué le pasa a Ana si el proxy borra las cookies con un 401?
**Answer:** El primero recibe 200 y un par nuevo, y la API anula el refresh viejo. El segundo recibe 401 por usar un refresh anulado. Si el proxy borra las cookies, Ana pierde la sesión sin haber hecho nada.
**Source:** `config/settings/base.py`, líneas 166–172 (`ROTATE_REFRESH_TOKENS`, `BLACKLIST_AFTER_ROTATION`); `accounts/tests/test_auth.py`, `test_refresh_rotates_and_blacklists_old_token`.

### Un Server Component no escribe cookies

**Question:** Si `getCurrentUser()`, durante el render, refrescara el token, ¿qué podría hacer con el refresh nuevo?
**Answer:** Nada: un Server Component solo lee cookies, porque *"HTTP does not allow setting cookies after streaming starts"*. Y como la API ya anuló el refresh viejo, el nuevo se perdería. Por eso el refresh vive en el proxy, antes del render.
**Source:** [cookies — Good to know](https://nextjs.org/docs/app/api-reference/functions/cookies#good-to-know) y [Understanding Cookie Behavior in Server Components](https://nextjs.org/docs/app/api-reference/functions/cookies#understanding-cookie-behavior-in-server-components) (local: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).

### Cookies en el request y en la respuesta

**Question:** El proxy obtuvo A2 y R2. ¿Dónde los escribe para que el render de este request lea A2 y el navegador los guarde? ¿Qué diferencia hay entre `NextResponse.next({ request: { headers } })` y `NextResponse.next({ headers })`?
**Answer:** En los dos lados: en el request (`request.cookies.set` más `{ request: { headers } }`, que llega al header `Cookie` que lee `cookies()`) y en la respuesta (`response.cookies.set`, que sale como `Set-Cookie`). `{ request: { headers } }` manda headers hacia la página y no al cliente; `{ headers }` los manda al navegador y no es buena práctica.
**Source:** [NextResponse — `next()`](https://nextjs.org/docs/app/api-reference/functions/next-response#next); [proxy.js — Using Cookies](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#using-cookies).

### Los Server Actions pasan por el proxy

**Question:** Con A1 vencido, Ana hace clic en un botón con un Server Action. ¿Pasa por el proxy? ¿Qué token lee el action? ¿Basta con el proxy?
**Answer:** Sí: un action es un `POST` a la ruta donde se usa, y el matcher no excluye esa ruta. Lee A2, porque el proxy refresca antes y le pasa el header `Cookie` actualizado. No basta con el proxy: el action revisa por su cuenta, y un 401 de la API cierra la sesión.
**Source:** [proxy.js — Execution order](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#execution-order) (local: `proxy.md`, líneas 249–251); [NextResponse — `next()`](https://nextjs.org/docs/app/api-reference/functions/next-response#next).

### Grupos de rutas

**Question:** Con `app/(app)/layout.tsx`, `app/(app)/page.tsx` y `app/(auth)/login/page.tsx`, ¿en qué URL queda cada página, el login muestra la sidebar, y qué pasa si no borras `app/page.tsx`?
**Answer:** `(app)/page.tsx` queda en `/` y el login en `/login`, porque los paréntesis no entran en la URL. El login no tiene sidebar, porque está fuera de `(app)`. Si no borras `app/page.tsx`, dos archivos resuelven a `/` y es un error.
**Source:** [Route Groups — Convention y Caveats](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) (local: `route-groups.md`, líneas 10–12 y 31).

### El usuario en el layout

**Question:** Con `cacheComponents: true`, ¿qué pasa si el layout del shell hace `await getCurrentUser()` arriba del `return`, sin `<Suspense>`?
**Answer:** Falla `next build`: leer `cookies()` fuera de un `<Suspense>` es un error de build. Lo que depende del usuario va en un componente propio dentro de `<Suspense>`, y el marco del shell queda en el static shell.
**Source:** [Authentication with Cache Components — Step 2 y Step 3](https://nextjs.org/docs/app/guides/authentication-with-cache-components#step-2-show-the-user-without-blocking-the-page) (local: `authentication-with-cache-components.md`, líneas 117 y 164).

### Cuánto dura `cache()`

**Question:** Tres componentes llaman a `getCurrentUser()` en una navegación. ¿Cuántos requests a `/auth/me/` salen sin `cache()` y con él? ¿Y en un Server Action que la llama dos veces?
**Answer:** Sin `cache()`, tres; con `cache()`, uno, y solo durante ese render. En un Server Action salen dos, porque no es un render pass y `cache()` no hace nada ahí.
**Source:** [Authentication — Creating a DAL](https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal) (local: `authentication.md`, línea 1181); [Fetching Data — Reusing data with `React.cache`](https://nextjs.org/docs/app/getting-started/fetching-data#reusing-data-with-reactcache) (línea 604).

### Un token falsificado

**Question:** Alguien edita su cookie `access`: `exp` en 2099, `user_id` de un superadmin, la firma original. ¿El proxy lo deja pasar? ¿Qué ve y quién lo detiene? ¿Es un problema que el proxy no verifique la firma?
**Answer:** El proxy lo deja pasar, porque solo mira `exp`. Ve el marco de la sidebar y un skeleton, que no tienen datos. La API verifica la firma, responde 401, y el usuario pasa por `/salir` al login. No es un problema: el proxy hace un chequeo *optimistic* y la API el *secure*.
**Source:** [Authentication — Authorization](https://nextjs.org/docs/app/guides/authentication#authorization) (local: `authentication.md`, líneas 1017–1018 y 1033); `rest_framework_simplejwt/exceptions.py`, líneas 53–56.

### El logout y el botón "Atrás"

**Question:** Ana cierra sesión con un Server Action que borra las cookies y redirige al login. El siguiente vendedor aprieta "Atrás". ¿Qué pasa?
**Answer:** Termina en el login. `cookies.delete` invalida el Client Cache, así que el router pide la página al servidor, y el proxy, sin cookies, redirige. La blacklist solo anula el refresh: el access sigue válido hasta su `exp`, por eso borrar las cookies es obligatorio.
**Source:** [Glossary — Client Cache](https://nextjs.org/docs/app/glossary#client-cache) (local: `04-glossary.md`, líneas 49–51).

### Estado global en el proxy

**Question:** El proxy deduplica los refrescos con un `Map` a nivel de módulo, y la documentación dice no depender de módulos compartidos ni globales. ¿Por qué lo advierte, por qué funciona aquí y dónde fallaría?
**Answer:** El proxy puede desplegarse en una CDN o en varias instancias, con un `Map` por entorno. Aquí funciona porque un solo proceso de Node.js atiende todo. Con varios servidores, los requests concurrentes caerían en `Map` distintos, los dos refrescarían con el mismo token y el segundo recibiría 401: un logout aleatorio.
**Source:** [proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), "Good to know" de la introducción (local: `proxy.md`, líneas 17–21).

### Dónde viven las opciones de las cookies

**Question:** El proxy, el login, el logout y `/salir` usan las mismas cookies y opciones. ¿Dónde viven los nombres, las opciones y el decodificador?
**Answer:** En un módulo de sesión propio (`lib/session.ts`) que importan los cuatro. La advertencia sobre módulos compartidos es sobre **estado**, no sobre importar código; el ejemplo oficial de `proxy.ts` importa `app/lib/session.ts`. El DAL queda aparte.
**Source:** [Authentication — Optimistic checks with Proxy](https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-proxy-optional) (local: `authentication.md`, líneas 1037–1040, 569, 680 y 803).

### Qué tipo de archivo es `/salir`

**Question:** Un 401 durante el render hace `redirect("/salir?next=…")`, y `/salir` tiene que borrar cookies `httpOnly`. ¿Qué tipo de archivo es?
**Answer:** Un Route Handler con `GET`. Una página es render y no escribe cookies, un Client Component no ve cookies `httpOnly`, y un Server Action llamado desde el render corre dentro del mismo render.
**Source:** [cookies — Good to know](https://nextjs.org/docs/app/api-reference/functions/cookies#good-to-know) (líneas 71–74); [Data Security — Avoiding side-effects during rendering](https://nextjs.org/docs/app/guides/data-security#avoiding-side-effects-during-rendering) (línea 569).

### Quién decide y qué hace Next.js

**Question:** Entre el navegador, Next.js y Django, ¿quién decide quién es Ana y qué puede hacer? ¿Cuál es el trabajo de Next.js?
**Answer:** Django. Next.js guarda las llaves de Ana: obtiene los tokens, los guarda en cookies `httpOnly`, los usa en cada request, los renueva y los descarta.
**Source:** `docs/roadmap.md`, "How it fits together" (líneas 36–54) y "Who decides permissions" (línea 79).

### Dos tokens

**Question:** ¿Para qué sirve cada token, y por qué no basta con uno solo que dure 7 días?
**Answer:** El access autentica cada request; el refresh solo sirve para obtener un access nuevo. Un token que no se puede anular solo se limita con su duración: uno de 7 días le daría 7 días a un ladrón. Los permisos no son el problema, porque Django los lee de la base de datos en cada request.
**Source:** `config/settings/base.py`, líneas 166–172; `rest_framework_simplejwt/authentication.py`, líneas 125, 132 y 138.

### Qué tiene un JWT

**Question:** Ana copia su access token. ¿Puede leerlo sin ninguna clave? ¿Qué impide que cambie el `user_id`?
**Answer:** Sí, el payload es Base64-URL y lo lee cualquiera. La firma se calcula con una clave que solo tiene Django: si cambia el payload, la firma deja de calzar y la API responde 401.
**Source:** [jwt.io — Introduction](https://www.jwt.io/introduction), secciones "Payload" y "Signature".

### `httpOnly` y los dos tramos

**Question:** Con un XSS, ¿qué pasa con tokens en `localStorage` y en cookies `httpOnly`? ¿Cómo llega el token a Django?
**Answer:** En `localStorage`, el atacante se lleva el token; con `httpOnly`, no puede leerlo. El token viaja en dos sobres: el navegador manda `Cookie` a Next.js solo, y Next.js manda `Authorization: Bearer` a Django.
**Source:** [MDN — Block access to your cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#block_access_to_your_cookies); `docs/roadmap.md`, líneas 39–43 y 76; `lib/api/client.ts`.

### Dónde vive la sesión

**Question:** ¿Dónde vive la sesión de Ana? ¿Qué crea el login, qué destruye el logout, y de qué otras formas termina la sesión?
**Answer:** Solo en las dos cookies; Next.js no guarda nada de Ana entre requests. El login pide los tokens a Django y los guarda; el logout anula el refresh y borra las cookies. También termina cuando vence el refresh (7 días), cuando la API responde 401 durante el render (`/salir`) o cuando rechaza el refresh en el proxy.
**Source:** `docs/roadmap.md`, líneas 166–173 y 76.

### Dónde corre el login

**Question:** El formulario es un Client Component. ¿Dónde corre `login`, cómo llegan los tokens al navegador y qué lleva el estado si falla?
**Answer:** En el servidor: el navegador manda email y contraseña en un `POST`. Los tokens vuelven como `Set-Cookie` y el componente nunca los ve. El estado lleva el mensaje y el email, nunca la contraseña ni los tokens, porque todo lo que devuelve el action llega al navegador.
**Source:** [Mutating Data — What are Server Functions](https://nextjs.org/docs/app/getting-started/mutating-data#what-are-server-functions) (local: `07-mutating-data.md`, líneas 18 y 29).

### El margen de 30 segundos

**Question:** Sin margen, el proxy deja pasar un access al que le queda 1 segundo. ¿Qué pasa y qué ve Ana?
**Answer:** El token vence mientras el render llama a la API, que responde 401. Ana pasa por `/salir` y pierde la sesión aunque su refresh servía por días. El margen evita logouts falsos: es experiencia, no seguridad.
**Source:** `docs/roadmap.md`, líneas 78 y 179; `rest_framework_simplejwt/exceptions.py`, líneas 53–56.

### CSRF

**Question:** Una página de otro sitio envía un formulario oculto con `POST` a nuestra app. ¿Cómo se llama el ataque y qué lo frena?
**Answer:** CSRF: el navegador adjunta las cookies solo. Lo frenan dos capas: `SameSite=Lax` no adjunta la cookie en un `POST` de otro sitio, y Next.js compara `Origin` con `Host` y aborta. `allowedOrigins` sirve para sumar orígenes, no para bloquear.
**Source:** [Data Security — Allowed origins](https://nextjs.org/docs/app/guides/data-security#allowed-origins-advanced) (local: `data-security.md`, líneas 546–550).

### La ruta actual en el render

**Question:** `renderApiErrorForPage` necesita la ruta actual para armar `/salir?next=…`, y un Server Component no tiene una API para eso. ¿De dónde la saca?
**Answer:** De un header que pone el proxy (`x-current-path`) con `NextResponse.next({ request: { headers } })`, y que el helper lee con `headers()`. `usePathname()` es de cliente, `window` no existe en el servidor y `Referer` es la página anterior.
**Source:** [proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) (local: `proxy.md`, línea 21); [NextResponse — `next()`](https://nextjs.org/docs/app/api-reference/functions/next-response#next); [headers](https://nextjs.org/docs/app/api-reference/functions/headers).

### `redirect()` dentro del `try`

**Question:** En el action de login, `redirect(next)` está dentro del `try` y el `catch` devuelve "No se pudo conectar con la API.". Con credenciales correctas, ¿qué ve Ana?
**Answer:** "No se pudo conectar…": `redirect()` lanza `NEXT_REDIRECT` y el `catch` lo atrapa. El build no lo detecta. El `try` envuelve solo la llamada a la API y `redirect()` va al final, afuera.
**Source:** [redirect — Behavior](https://nextjs.org/docs/app/api-reference/functions/redirect#behavior) (local: `redirect.md`, líneas 49–53 y 62).

### Casos borde y seguridad

**Question:** Además de los casos vistos en el quiz, ¿qué entradas raras o respuestas inesperadas tiene que manejar el plan?
**Answer:**
- **`next` hacia otro sitio:** `//malo.com`, `https://malo.com` y `/\malo.com`, que el parser lee como `//malo.com`. Se valida parseando con `URL` y comparando el origen.
- **`next=/login` o `next=/salir`:** el segundo cierra la sesión recién abierta. Los dos van a `/` en silencio, como cualquier `next` inválido.
- **Inyección en el login:** el frontend manda JSON y React escapa lo que muestra; no hace falta código extra.
- **Un `POST` sin sesión:** un 307 del proxy repetiría el `POST` contra `/login`, así que el proxy solo redirige `GET` y el action se entera por el 401.
- **Un 503 o una falla de red al refrescar:** se conservan las cookies y el fallo no se guarda en el `Map`.
- **Una cookie ilegible:** se trata como vencida; una excepción en el proxy tumbaría todas las páginas, incluido el login.
- **El límite de login compartido:** la API ve a Next.js como un solo cliente. Se acepta y se documenta en el roadmap.
- **Un link externo a `/salir`:** cierra la sesión, pero no da acceso a nada. Se acepta.
- **La API caída mientras se navega:** `error.tsx` muestra un mensaje fijo y "Reintentar".
**Source:** [WHATWG URL — URL parsing](https://url.spec.whatwg.org/#url-parsing); [OWASP — Unvalidated Redirects and Forwards](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html); [redirect — FAQ](https://nextjs.org/docs/app/api-reference/functions/redirect#why-does-redirect-use-307-and-308) (local: `redirect.md`, línea 215); `node_modules/next/dist/server/web/spec-extension/response.js`, línea 95.
