// Same for every request, so they are created once at module level.
const clpFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });
const numberFormatter = new Intl.NumberFormat("es-CL");

const numericDateOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

/** DRF sends decimals as strings ("12990.00"); CLP has no minor unit, so this shows "$12.990". */
export function formatCLP(amount: string | number): string {
  return clpFormatter.format(Number(amount));
}

export function formatNumber(value: string | number): string {
  return numberFormatter.format(Number(value));
}

/** A date-time from the API, shown in the given IANA time zone, e.g. a store's "America/Santiago". */
export function formatDateTime(isoDateTime: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    ...numericDateOptions,
    hour: "2-digit",
    minute: "2-digit",
    // 24-hour clock ("14:05"); es-CL data alone gives "02:05 p. m.".
    hourCycle: "h23",
    timeZone,
  }).format(new Date(isoDateTime));
}

/** A date without time ("2024-03-15"). JavaScript parses it as UTC midnight, so format it in UTC too. */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("es-CL", { ...numericDateOptions, timeZone: "UTC" }).format(
    new Date(isoDate),
  );
}
