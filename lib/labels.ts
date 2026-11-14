import type { components } from "@/lib/api/schema";

type RegionCode = components["schemas"]["RegionEnum"];
type StoreStatusCode = components["schemas"]["StatusEnum"];
type MovementTypeCode = components["schemas"]["TypeEnum"];
// User.role comes from a SerializerMethodField, so the schema types it as `string | null`.
// The schema's RoleEnum only covers store assignments ("seller" | "manager"), not "superadmin".
type RoleCode = "seller" | "manager" | "superadmin";

export const regionNames: Record<RegionCode, string> = {
  AP: "Arica y Parinacota",
  TA: "Tarapacá",
  AN: "Antofagasta",
  AT: "Atacama",
  CO: "Coquimbo",
  VS: "Valparaíso",
  RM: "Metropolitana de Santiago",
  LI: "O'Higgins",
  ML: "Maule",
  NB: "Ñuble",
  BI: "Biobío",
  AR: "La Araucanía",
  LR: "Los Ríos",
  LL: "Los Lagos",
  AI: "Aysén",
  MA: "Magallanes",
};

export const storeStatusNames: Record<StoreStatusCode, string> = {
  open: "Abierta",
  temporarily_closed: "Cerrada temporalmente",
  closed: "Cerrada",
};

export const movementTypeNames: Record<MovementTypeCode, string> = {
  opening: "Saldo inicial",
  purchase: "Compra",
  sale: "Venta",
  adjustment: "Ajuste",
};

export const roleNames: Record<RoleCode, string> = {
  seller: "Vendedor",
  manager: "Encargado de tienda",
  superadmin: "Administración central",
};

/** The Spanish name for a code, or the code itself if the API sends one we don't know yet. */
export function spanishNameOrCode(names: Record<string, string>, code: string): string {
  return names[code] ?? code;
}
