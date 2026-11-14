import { Suspense } from "react";

import { createApiClient } from "@/lib/api/client";

type ApiHealthCheckResult = "connected" | "database_unavailable" | "api_error" | "unreachable";

const apiHealthCheckMessages: Record<ApiHealthCheckResult, string> = {
  connected: "API conectada",
  database_unavailable: "La API responde, pero su base de datos no está disponible.",
  api_error: "La API respondió con un error.",
  unreachable: "No se pudo conectar con la API.",
};

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-32 font-sans">
      <h1 className="text-4xl font-bold sm:text-5xl">Simulador de Cadena de Tiendas</h1>
      <Suspense
        fallback={<p className="text-muted-foreground">Verificando la conexión con la API…</p>}
      >
        <ApiHealthStatus />
      </Suspense>
    </main>
  );
}

async function ApiHealthStatus() {
  // Outside the try: a missing API_URL is a configuration bug. It must reach the error page
  // with its own message, not be reported as "unreachable".
  const api = createApiClient();

  let healthCheckResult: ApiHealthCheckResult;
  try {
    const { response } = await api.GET("/api/health/");
    if (response.ok) {
      healthCheckResult = "connected";
    } else if (response.status === 503) {
      healthCheckResult = "database_unavailable";
    } else {
      console.error(`La API respondió ${response.status} en /api/health/.`);
      healthCheckResult = "api_error";
    }
  } catch (error) {
    // The cause carries internal details (e.g. "connect ECONNREFUSED 10.0.3.17:8000"):
    // log it on the server, show the user a fixed message.
    console.error("No se pudo conectar con la API:", error);
    healthCheckResult = "unreachable";
  }

  return <p role="status">{apiHealthCheckMessages[healthCheckResult]}</p>;
}
