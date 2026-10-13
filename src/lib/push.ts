// Push real (FCM): registra este navegador para recibir notificaciones aunque la
// app esté cerrada. El token se guarda en users/{uid}.fcmTokens y la Cloud Function
// functions/index.js le manda el push cuando se crea una alerta. La notificación la
// muestra public/sw.js (evento "push").

import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { doc, setDoc, arrayUnion } from "firebase/firestore";
import { app, db } from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

export async function registerPush(uid: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!VAPID_KEY) {
    console.warn("[push] Falta NEXT_PUBLIC_FIREBASE_VAPID_KEY; sin push en segundo plano.");
    return false;
  }
  if (!(await isSupported())) return false;
  if (Notification.permission !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });
    if (!token) return false;
    await setDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token) }, { merge: true });
    return true;
  } catch (err) {
    console.warn("[push] No se pudo registrar:", err);
    return false;
  }
}
