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
import { auth, db } from "./firebase";
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

/**
 * Vincula un bastón a la cuenta. Devuelve si quedó como dueño o como cuidador.
 *
 * Antes pisaba el doc sin mirar: si OTRO familiar emparejaba el mismo bastón (en
 * vez de usar el código de invitación), pasaba a ser el dueño, se borraba la
 * lista de cuidadores y cambiaba el código. El dueño original seguía viéndolo,
 * pero dejaba de recibir las push (/api/notify solo avisa a ownerUid +
 * caregiverUids) sin enterarse. Ahora, si ya tiene dueño, se suma como cuidador.
 *
 * Ojo: que el doc exista no significa que tenga dueño. El heartbeat del bastón
 * crea `devices/{id}` con solo la telemetría si nadie lo emparejó todavía.
 */
export async function createDevice(
  deviceId: string,
  ownerUid: string,
  name: string,
  bluetoothId?: string
): Promise<"owner" | "caregiver"> {
  const ref = doc(db, "devices", deviceId);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as Partial<DeviceDoc>) : null;

  if (existing?.ownerUid && existing.ownerUid !== ownerUid) {
    await updateDoc(ref, { caregiverUids: arrayUnion(ownerUid) });
    return "caregiver";
  }

  await setDoc(
    ref,
    {
      deviceId,
      name,
      ownerUid,
      bluetoothId: bluetoothId ?? null,
      // Lo que ya tenga (cuidadores, código, telemetría del bastón) no se toca.
      ...(existing?.caregiverUids ? {} : { caregiverUids: [] }),
      ...(existing?.inviteCode ? {} : { inviteCode: generateInviteCode() }),
      ...(existing
        ? {}
        : {
            batteryLevel: -1, // "sin medir" hasta el primer heartbeat (antes decía 100 %)
            isOnline: false,
            lastSeen: serverTimestamp(),
            location: { lat: 0, lng: 0 },
            speed: 0
          })
    },
    { merge: true }
  );
  return "owner";
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
  const ref = doc(db, "devices", deviceId);
  if (!isOwner) {
    await updateDoc(ref, { caregiverUids: arrayRemove(uid) });
  } else {
    // El dueño se va: el bastón pasa al primer cuidador, o queda sin dueño si no
    // hay ninguno. Antes no se tocaba el doc, y el ex dueño seguía recibiendo las
    // push de un bastón que había eliminado.
    const snap = await getDoc(ref);
    const caregivers = (snap.data()?.caregiverUids as string[] | undefined) ?? [];
    const nextOwner = caregivers.find((c) => c !== uid) ?? null;
    await updateDoc(ref, {
      ownerUid: nextOwner,
      caregiverUids: arrayRemove(uid, ...(nextOwner ? [nextOwner] : []))
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

/**
 * Crea una alerta desde la PWA (botón SOS de respaldo).
 *
 * `locationSource` NO es cosmético: este SOS se usa cuando el usuario está
 * separado del bastón, así que la familia tiene que poder distinguir "esta es
 * la posición del teléfono" de "esta es la última posición conocida del bastón".
 */
export async function createSosAlert(
  deviceId: string,
  location: { lat: number; lng: number },
  locationSource: "device" | "phone" | "unknown" = "device"
): Promise<void> {
  const ref = await addDoc(collection(db, "alerts"), {
    deviceId,
    timestamp: serverTimestamp(),
    location,
    photoUrl: "",
    audioUrl: "",
    seen: false,
    source: "pwa_sos", // diferenciador del SOS físico del ESP32
    locationSource
  });
  // Push a la familia (llega aunque tengan la app cerrada). Si falla, la alerta
  // igual quedó creada y se ve en la app.
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (idToken) {
      await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ alertId: ref.id })
      });
    }
  } catch (err) {
    console.warn("[notify] no se pudo avisar:", err);
  }
}

// ----------------- "ENCONTRAR EL BASTÓN" (orden de la app al bastón) -----------------

/** Tope de segundos que pedimos por vez. El firmware también lo limita. */
export const RING_SECONDS = 30;

/**
 * Hace sonar el buzzer del bastón para poder encontrarlo de oído.
 *
 * Se escribe en `devices/{deviceId}`: el bastón lo recibe en la respuesta de su
 * heartbeat (cada 10 s) sin gastar lecturas. Antes iba en `commands/{deviceId}`
 * y el bastón lo leía con un GET cada 5 s: 17.280 lecturas por día de la cuota
 * gratis de Firestore, solo por estar prendido. (Antes no se podía usar
 * `devices/` porque el heartbeat pisaba el doc entero; ahora usa updateMask.)
 *
 * `ringToken` es un nonce, no una marca de tiempo a comparar: el firmware solo
 * chequea si cambió respecto del último que vio. Así la función anda igual
 * aunque el reloj del celular esté desfasado.
 */
export async function ringDevice(
  deviceId: string,
  requestedBy: string,
  seconds: number = RING_SECONDS
): Promise<number> {
  const ringToken = Date.now();
  await updateDoc(doc(db, "devices", deviceId), {
    ringToken,
    ringSeconds: seconds,
    ringRequestedBy: requestedBy,
    ringRequestedAt: serverTimestamp()
  });
  // Lo devolvemos para que la pantalla pueda esperar el `ackToken` del bastón
  // (que llega en el mismo doc del bastón que ya escucha).
  return ringToken;
}

/** Corta el pitido antes de que se cumpla el tiempo (mismo camino, con 0 s). */
export async function stopRing(deviceId: string, requestedBy: string): Promise<number> {
  return ringDevice(deviceId, requestedBy, 0);
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

  // Los ÚLTIMOS 2000 (desc) y después se dan vuelta. Con "asc + limit" venían los
  // primeros 2000 del día: a un punto cada 30 s, pasadas ~16 h los puntos nuevos
  // quedaban afuera y el recorrido del mapa se congelaba.
  const q = query(
    collection(db, "locations", deviceId, "history"),
    where("timestamp", ">=", startTs),
    orderBy("timestamp", "desc"),
    limit(2000)
  );

  return onSnapshot(q, (snap) => {
    const points: LocationPoint[] = snap.docs.map((d) => d.data() as LocationPoint).reverse();
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

// 30 y no 100: sin Storage (plan gratis) la foto y el audio viajan DENTRO del
// doc de la alerta, ~250 KB cada una. 100 alertas eran ~25 MB de datos móviles
// cada vez que la familia abría el historial.
export function listenAlertHistory(
  deviceId: string,
  cb: (alerts: AlertDoc[]) => void,
  max = 30
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
