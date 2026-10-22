// Qué tan confiable es una ubicación, en un solo lugar.
//
// El bastón manda lat/lng = 0,0 cuando nunca tuvo GPS (antes mandaba el
// Obelisco, y el mapa lo mostraba como si fuera real). Todas las pantallas
// tienen que tratar ese 0,0 como "sin ubicación": un punto falso en el mapa es
// peor que ningún punto, porque la familia puede salir a buscar ahí.

import type { AlertDoc, DeviceDoc, GeoPoint } from "@/types";

/** Buenos Aires: solo para centrar el mapa cuando no hay nada que mostrar. */
export const DEFAULT_MAP_CENTER: GeoPoint = { lat: -34.6037, lng: -58.3816 };

/** true si es una posición real (no vacía, no 0,0). */
export function hasRealLocation(p?: GeoPoint | null): p is GeoPoint {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    !(p.lat === 0 && p.lng === 0)
  );
}

export type Tone = "ok" | "warn" | "bad";

export interface LocationNote {
  text: string;
  tone: Tone;
  /** false = no hay posición que mostrar en el mapa. */
  hasLocation: boolean;
}

/** Estado del GPS del bastón para el dashboard. */
export function deviceLocationNote(device: DeviceDoc | null): LocationNote | null {
  if (!device) return null;
  if (!hasRealLocation(device.location)) {
    return {
      text: "El bastón todavía no tiene señal GPS: no hay ubicación para mostrar.",
      tone: "bad",
      hasLocation: false
    };
  }
  // gpsFix lo manda el firmware nuevo; con uno viejo no sabemos, así que no
  // mostramos cartel (es lo que se veía antes).
  if (device.gpsFix === false) {
    return {
      text: "Sin señal GPS ahora: el punto es la última ubicación conocida.",
      tone: "warn",
      hasLocation: true
    };
  }
  return null;
}

/** De dónde salió la ubicación de una alerta, en palabras para la familia. */
export function alertLocationNote(alert: AlertDoc): LocationNote {
  const real = hasRealLocation(alert.location);

  if (alert.source === "pwa_sos") {
    if (alert.locationSource === "phone" && real)
      return { text: "Desde la app · Ubicación del teléfono", tone: "ok", hasLocation: true };
    if (alert.locationSource === "unknown" || !real)
      return { text: "Desde la app · Sin ubicación disponible", tone: "bad", hasLocation: false };
    return {
      text: "Desde la app · Última ubicación del bastón (puede no ser la de la persona)",
      tone: "warn",
      hasLocation: true
    };
  }

  // Alertas del bastón
  if (!real || alert.locationSource === "unknown")
    return {
      text: "El bastón no tenía señal GPS: no hay ubicación de esta alerta",
      tone: "bad",
      hasLocation: false
    };
  if (alert.locationSource === "device_last")
    return {
      text: "Última ubicación conocida del bastón (el GPS había perdido señal)",
      tone: "warn",
      hasLocation: true
    };
  return { text: "Ubicación del GPS del bastón", tone: "ok", hasLocation: true };
}

/** Qué disparó la alerta. */
export function alertTriggerLabel(alert: AlertDoc): string {
  if (alert.source === "pwa_sos") return "SOS desde la app";
  switch (alert.trigger) {
    case "boton":
      return "Botón de emergencia";
    case "caida":
      return "Caída detectada";
    case "prueba":
      return "Alerta de prueba";
    default:
      return "Alerta de emergencia";
  }
}

export const TONE_CLASS: Record<Tone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400"
};

/**
 * Extensión para descargar un archivo de la alerta. La foto y el audio pueden
 * venir como data URL (plan gratis de Firebase, sin Storage): el tipo real está
 * en el prefijo "data:audio/wav;...".
 */
export function mediaExtension(url: string, fallback: string): string {
  const m = /^data:[a-z]+\/([a-z0-9.+-]+)[;,]/i.exec(url);
  if (!m) return fallback;
  const sub = m[1].toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "x-wav" || sub === "wave") return "wav";
  if (sub === "mpeg") return "mp3";
  return sub;
}
