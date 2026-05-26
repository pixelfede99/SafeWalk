// Helpers para el modo demo: crea un baston ficticio con datos realistas
// para poder probar la app sin tener el ESP32 fisico.

import {
  collection,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { db } from "./firebase";

// Coordenadas de Plaza de Mayo, Buenos Aires
const BASE_LAT = -34.6083;
const BASE_LNG = -58.3712;

export function makeDemoDeviceId(uid: string): string {
  return `demo-${uid.slice(0, 8)}`;
}

/**
 * Crea un dispositivo demo + un recorrido del dia (puntos de los ultimos 30 min).
 */
export async function seedDemoDevice(uid: string): Promise<string> {
  const deviceId = makeDemoDeviceId(uid);

  // 1. Crear el documento del dispositivo
  await setDoc(doc(db, "devices", deviceId), {
    deviceId,
    name: "Bastón Demo",
    ownerUid: uid,
    caregiverUids: [uid], // el mismo usuario es duenio y cuidador para el demo
    batteryLevel: 87,
    isOnline: true,
    lastSeen: serverTimestamp(),
    location: { lat: BASE_LAT, lng: BASE_LNG },
    speed: 1.2,
    bluetoothId: null
  });

  // 2. Sembrar puntos de historial (caminata de 30 min)
  const now = Date.now();
  const points: { lat: number; lng: number; ms: number }[] = [];
  for (let i = 0; i < 20; i++) {
    points.push({
      lat: BASE_LAT + (Math.cos(i / 3) * 0.0006 - i * 0.00004),
      lng: BASE_LNG + (Math.sin(i / 3) * 0.0008 + i * 0.00006),
      ms: now - (20 - i) * 90_000
    });
  }
  for (const p of points) {
    await addDoc(collection(db, "locations", deviceId, "history"), {
      lat: p.lat,
      lng: p.lng,
      timestamp: Timestamp.fromMillis(p.ms)
    });
  }

  return deviceId;
}

/**
 * Crea una alerta de prueba con foto/audio publicos (placeholders).
 */
export async function seedDemoAlert(deviceId: string): Promise<void> {
  await addDoc(collection(db, "alerts"), {
    deviceId,
    timestamp: serverTimestamp(),
    location: {
      lat: BASE_LAT + (Math.random() - 0.5) * 0.002,
      lng: BASE_LNG + (Math.random() - 0.5) * 0.002
    },
    photoUrl: `https://picsum.photos/seed/safewalk-${Date.now()}/640/480`,
    // Audio publico de muestra para que se vea el reproductor
    audioUrl: "https://www.w3schools.com/html/horse.mp3",
    seen: false
  });
}
