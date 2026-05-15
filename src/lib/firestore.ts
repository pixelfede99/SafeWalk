import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type Unsubscribe
} from "firebase/firestore";
import { db } from "./firebase";
import type { UserDoc, UserRole, DeviceDoc, AlertDoc, LocationPoint } from "@/types";

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
  await updateDoc(doc(db, "users", uid), { role });
}

export async function setUserDevice(uid: string, deviceId: string): Promise<void> {
  await updateDoc(doc(db, "users", uid), { deviceId });
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
      bluetoothId: bluetoothId ?? null
    },
    { merge: true }
  );
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
