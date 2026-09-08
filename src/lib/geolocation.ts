// Ubicación del TELÉFONO (no la del bastón).
//
// Existe por un motivo concreto: el SOS de respaldo de la PWA se usa justamente
// cuando el usuario NO tiene el bastón encima. Mandar `device.location` en ese
// caso le da a la familia la posición del bastón, que puede estar en otra casa.

import type { GeoPoint } from "@/types";

export interface PhoneLocation {
  location: GeoPoint;
  source: "phone" | "device" | "unknown";
  /** Precisión en metros que reportó el GPS del teléfono, si la dio. */
  accuracy?: number;
}

/**
 * Pide la ubicación del teléfono con un timeout corto.
 *
 * En una emergencia no podemos quedarnos esperando un fix: si el navegador no
 * contesta en `timeoutMs`, caemos al fallback (la última ubicación conocida del
 * bastón) y lo marcamos como tal para que la familia sepa qué está mirando.
 */
export async function getPhoneLocation(
  fallback?: GeoPoint | null,
  timeoutMs = 8000
): Promise<PhoneLocation> {
  const fallbackResult: PhoneLocation = fallback
    ? { location: fallback, source: "device" }
    : { location: { lat: 0, lng: 0 }, source: "unknown" };

  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return fallbackResult;
  }

  return new Promise<PhoneLocation>((resolve) => {
    let settled = false;
    const finish = (result: PhoneLocation) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Red de seguridad propia: algunos navegadores móviles ignoran el `timeout`
    // de las opciones cuando el permiso está en "preguntar siempre".
    const timer = setTimeout(() => finish(fallbackResult), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          source: "phone",
          accuracy: pos.coords.accuracy
        });
      },
      () => {
        // Permiso denegado, sin señal, o error del navegador: usamos el fallback.
        clearTimeout(timer);
        finish(fallbackResult);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}
