// ¿El bastón está realmente conectado?
//
// El campo `isOnline` de Firestore NO alcanza para saberlo: el firmware lo
// escribe en `true` en cada heartbeat y nadie lo pone nunca en `false`. Cuando
// el bastón se queda sin batería o sin WiFi deja de escribir, y el campo queda
// en `true` para siempre — la app mostraba "CONECTADO" con el bastón apagado.
//
// Y no se puede arreglar del lado del firmware: un bastón apagado no puede
// avisar que se apagó. La señal de que está muerto es la AUSENCIA de heartbeat,
// así que la conclusión la tiene que sacar quien lee, mirando `lastSeen`.

import type { DeviceDoc } from "@/types";

/**
 * Cuánto silencio toleramos antes de darlo por desconectado.
 *
 * El firmware manda heartbeat cada HEARTBEAT_INTERVAL_MS (10 s en config.h).
 * Damos 3 vueltas y media de margen para no marcarlo offline porque el WiFi se
 * trabó un segundo. Si cambiás el intervalo en el firmware, cambiá esto también.
 */
export const OFFLINE_AFTER_MS = 35_000;

export function isDeviceOnline(
  device: DeviceDoc | null | undefined,
  now: number = Date.now()
): boolean {
  if (!device) return false;

  // El bastón de DEMO no tiene heartbeat: `lastSeen` se escribe una sola vez al
  // sembrarlo. Con la regla de abajo se pondría "Offline" a los 35 s, que es lo
  // último que querés durante la defensa del proyecto. Su razón de ser es
  // mostrar la pantalla llena, no simular una desconexión.
  if (device.deviceId?.startsWith("demo-")) return true;

  // Respetamos un `false` explícito (ej. el doc recién creado desde la app,
  // que todavía no vio ningún heartbeat).
  if (device.isOnline === false) return false;

  const lastSeen = device.lastSeen?.toDate?.();
  if (!lastSeen) return false;

  return now - lastSeen.getTime() < OFFLINE_AFTER_MS;
}
