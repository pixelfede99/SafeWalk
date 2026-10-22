// Push real (FCM): registra este navegador para recibir notificaciones aunque la
// app esté cerrada. El token se guarda en users/{uid}.fcmTokens y la ruta /api/notify
// (Vercel, gratis) le manda el push cuando se crea una alerta. La notificación la
// muestra public/sw.js (evento "push").

import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";
import { doc, setDoc, arrayUnion, arrayRemove } from "firebase/firestore";
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

/**
 * Da de baja este navegador antes de cerrar sesión. Sin esto, el token quedaba
 * en la cuenta y el celular seguía recibiendo las alertas (con el nombre del
 * bastón) aunque ya nadie tuviera la sesión abierta: mal en un celular
 * compartido o prestado. Nunca tira error: cerrar sesión no puede fallar por esto.
 */
export async function unregisterPush(uid: string): Promise<void> {
  if (typeof window === "undefined" || !VAPID_KEY) return;
  try {
    if (!(await isSupported())) return;
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      await setDoc(doc(db, "users", uid), { fcmTokens: arrayRemove(token) }, { merge: true });
      await deleteToken(messaging);
    }
  } catch (err) {
    console.warn("[push] No se pudo dar de baja:", err);
  }
}
