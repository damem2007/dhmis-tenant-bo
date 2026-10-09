let accessToken = "";
let tenantSlug = "";
let activeLocationId = "";
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const inFlightMutations = new Map<string, Promise<unknown>>();
export function setToken(value: string) {
  accessToken = value;
}
export function setTenantSlug(value: string) {
  tenantSlug = value;
}
export function setActiveLocation(value: string) {
  activeLocationId = value;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  const requestMethod = method.toUpperCase();
  const serializedBody = body === undefined ? "" : JSON.stringify(body);
  const requestKey = `${requestMethod}:${path}:${serializedBody}:${accessToken}:${tenantSlug}:${activeLocationId}`;
  const existing = requestMethod === "GET" ? undefined : inFlightMutations.get(requestKey);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
    const response = await fetch(`${apiBase}/v1${path}`, {
      method: requestMethod,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(tenantSlug ? { "X-DHMIS-Tenant": tenantSlug } : {}),
        ...(activeLocationId ? { "X-DHMIS-Location": activeLocationId } : {}),
      },
      ...(body ? { body: serializedBody } : {}),
    });
    if (!response.ok) {
    if (response.status === 401) {
      setToken("");
      window.dispatchEvent(new Event("dhmis:unauthorized"));
    }
    //console.log(await response.json());
    const result = await response
      .json()
      .catch(() => ({ detail: "The service is unavailable" }));
    const detail = result.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg?: string }) => item.msg || "Invalid value").join("; ")
          : typeof detail?.message === "string"
            ? detail.message
            : "Request failed";
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  })();
  if (requestMethod === "GET") return request;
  window.dispatchEvent(new CustomEvent("dhmis:mutation-start", { detail: { requestKey } }));
  inFlightMutations.set(requestKey, request);
  try {
    return await request;
  } finally {
    window.dispatchEvent(new CustomEvent("dhmis:mutation-end", { detail: { requestKey } }));
    if (inFlightMutations.get(requestKey) === request) inFlightMutations.delete(requestKey);
  }
}

export async function download(path: string, filename: string) {
  const response = await fetch(`${apiBase}/v1${path}`, {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(tenantSlug ? { "X-DHMIS-Tenant": tenantSlug } : {}),
      ...(activeLocationId ? { "X-DHMIS-Location": activeLocationId } : {}),
    },
  });
  if (!response.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function authenticatedBlobUrl(path: string) {
  const response = await fetch(`${apiBase}/v1${path}`, {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(tenantSlug ? { "X-DHMIS-Tenant": tenantSlug } : {}),
      ...(activeLocationId ? { "X-DHMIS-Location": activeLocationId } : {}),
    },
  });
  if (!response.ok) throw new Error("File preview failed");
  return URL.createObjectURL(await response.blob());
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );
