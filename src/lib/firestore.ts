import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  Timestamp,
  type Unsubscribe
} from "firebase/firestore";
import { db } from "./firebase";
import type { UserDoc, UserRole, DeviceDoc, AlertDoc, LocationPoint } from "@/types";

// Genera un código de invitación de 6 chars (sin caracteres ambiguos)
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ----------------- USERS -----------------

export async function createUserDoc(uid: string, email: string, name: string): Promise<void> {
  await setDoc(doc(db, "users", uid), {
    uid,
    email,
    name,
    role: null,
    deviceId: null,
    createdAt: serverTimestamp()
  });
}

export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  // Usamos setDoc con merge para que funcione tanto si el doc existe
  // como si nunca se llegó a crear (ej. signup interrumpido).
  await setDoc(doc(db, "users", uid), { role }, { merge: true });
}

export async function setUserDevice(uid: string, deviceId: string): Promise<void> {
  // Setea el activo Y lo agrega al array de todos los círculos del usuario
  await setDoc(
    doc(db, "users", uid),
    { deviceId, deviceIds: arrayUnion(deviceId) },
    { merge: true }
  );
}

/** Cambia el dispositivo activo (sin tocar la lista de todos los círculos). */
export async function switchActiveDevice(uid: string, deviceId: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { deviceId });
}

/** Obtiene los docs de varios dispositivos en paralelo. */
export async function getDevices(deviceIds: string[]): Promise<DeviceDoc[]> {
  if (deviceIds.length === 0) return [];
  const results = await Promise.all(deviceIds.map((id) => getDoc(doc(db, "devices", id))));
  return results.filter((s) => s.exists()).map((s) => s.data() as DeviceDoc);
}

export function listenUserDoc(uid: string, cb: (u: UserDoc | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    cb(snap.exists() ? (snap.data() as UserDoc) : null);
  });
}

// ----------------- DEVICES -----------------

export async function createDevice(
  deviceId: string,
  ownerUid: string,
  name: string,
  bluetoothId?: string
): Promise<void> {
  await setDoc(
    doc(db, "devices", deviceId),
    {
      deviceId,
      name,
      ownerUid,
      caregiverUids: [],
      batteryLevel: 100,
      isOnline: false,
      lastSeen: serverTimestamp(),
      location: { lat: 0, lng: 0 },
      speed: 0,
      bluetoothId: bluetoothId ?? null,
      inviteCode: generateInviteCode()
    },
    { merge: true }
  );
}

/** Busca un dispositivo por código de invitación y agrega al usuario como cuidador. */
export async function joinDeviceByCode(uid: string, code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  const q = query(collection(db, "devices"), where("inviteCode", "==", normalized), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) {
    throw new Error("No encontramos ningún bastón con ese código.");
  }
  const deviceDoc = snap.docs[0];
  const deviceId = deviceDoc.id;
  await updateDoc(doc(db, "devices", deviceId), {
    caregiverUids: arrayUnion(uid)
  });
  // Lo seteamos como activo y lo agregamos al array de todos los círculos
  await setDoc(
    doc(db, "users", uid),
    { deviceId, deviceIds: arrayUnion(deviceId) },
    { merge: true }
  );
  return deviceId;
}

/** Desvincular al usuario del dispositivo y elegir otro activo si tiene varios. */
export async function leaveDevice(
  uid: string,
  deviceId: string,
  isOwner: boolean,
  remainingIds: string[]
): Promise<string | null> {
  if (!isOwner) {
    await updateDoc(doc(db, "devices", deviceId), {
      caregiverUids: arrayRemove(uid)
    });
  }
  // Si tenía otros círculos, seteamos el primero como activo. Sino null.
  const nextActive = remainingIds.length > 0 ? remainingIds[0] : null;
  await updateDoc(doc(db, "users", uid), {
    deviceId: nextActive,
    deviceIds: arrayRemove(deviceId)
  });
  return nextActive;
}

/** Crea una alerta desde la PWA (botón SOS de respaldo). */
export async function createSosAlert(
  deviceId: string,
  location: { lat: number; lng: number }
): Promise<void> {
  await addDoc(collection(db, "alerts"), {
    deviceId,
    timestamp: serverTimestamp(),
    location,
    photoUrl: "",
    audioUrl: "",
    seen: false,
    source: "pwa_sos" // diferenciador del SOS físico del ESP32
  });
}

/** Listener al doc de un device específico para una sola lectura. */
export async function getDevice(deviceId: string): Promise<DeviceDoc | null> {
  const snap = await getDoc(doc(db, "devices", deviceId));
  return snap.exists() ? (snap.data() as DeviceDoc) : null;
}

export function listenDevice(deviceId: string, cb: (d: DeviceDoc | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "devices", deviceId), (snap) => {
    cb(snap.exists() ? (snap.data() as DeviceDoc) : null);
  });
}

// ----------------- LOCATION HISTORY (recorrido del d&#237;a) -----------------

export function listenTodayHistory(
  deviceId: string,
  cb: (points: LocationPoint[]) => void
): Unsubscribe {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startTs = Timestamp.fromDate(startOfDay);

  const q = query(
    collection(db, "locations", deviceId, "history"),
    where("timestamp", ">=", startTs),
    orderBy("timestamp", "asc"),
    limit(2000)
  );

  return onSnapshot(q, (snap) => {
    const points: LocationPoint[] = snap.docs.map((d) => d.data() as LocationPoint);
    cb(points);
  });
}

// ----------------- ALERTS -----------------

export function listenLatestAlert(deviceId: string, cb: (a: AlertDoc | null) => void): Unsubscribe {
  const q = query(
    collection(db, "alerts"),
    where("deviceId", "==", deviceId),
    orderBy("timestamp", "desc"),
    limit(1)
  );
  return onSnapshot(q, (snap) => {
    if (snap.empty) {
      cb(null);
      return;
    }
    const d = snap.docs[0];
    cb({ id: d.id, ...(d.data() as Omit<AlertDoc, "id">) });
  });
}

export function listenAlertHistory(
  deviceId: string,
  cb: (alerts: AlertDoc[]) => void,
  max = 100
): Unsubscribe {
  const q = query(
    collection(db, "alerts"),
    where("deviceId", "==", deviceId),
    orderBy("timestamp", "desc"),
    limit(max)
  );
  return onSnapshot(q, (snap) => {
    const alerts: AlertDoc[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AlertDoc, "id">)
    }));
    cb(alerts);
  });
}

export async function markAlertSeen(alertId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "alerts", alertId), {
    seen: true,
    seenBy: [uid]
  });
}
