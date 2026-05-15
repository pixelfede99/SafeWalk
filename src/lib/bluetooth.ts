// Web Bluetooth API helpers.
// Soporte: Chrome / Edge en Android y desktop. Safari/iOS NO la soporta.
// Por eso siempre exponemos isSupported() y un fallback manual.

export interface ScannedDevice {
  id: string;
  name: string;
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Abre el chooser nativo del navegador. Devuelve un dispositivo elegido por el usuario.
 * El chooser ya muestra los dispositivos cercanos: Web Bluetooth no permite escanear y
 * mostrar la lista nosotros mismos por raz&#243;n de privacidad - el sistema operativo lo hace.
 *
 * Filtramos por prefijo de nombre "SafeWalk" para mostrar solo nuestros bastones.
 */
export async function requestSafeWalkDevice(): Promise<ScannedDevice> {
  if (!isWebBluetoothSupported()) {
    throw new Error("Tu navegador no soporta Web Bluetooth");
  }
  // @ts-expect-error - tipos de Web Bluetooth no incluidos en lib.dom por defecto
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: "SafeWalk" }],
    optionalServices: ["battery_service"]
  });
  return { id: device.id, name: device.name ?? "Bastón SafeWalk" };
}
