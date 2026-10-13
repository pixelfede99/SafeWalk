// Firebase Admin (solo servidor: rutas /api en Vercel). Credencial = cuenta de
// servicio del proyecto, en la variable FIREBASE_SERVICE_ACCOUNT (JSON completo).
// Generarla: Consola Firebase -> Configuración -> Cuentas de servicio -> Generar clave.
// Es gratis (plan Spark); FCM también.

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

let app: App | undefined;

export function getAdmin() {
  if (!app) {
    app = getApps()[0];
    if (!app) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) throw new Error("Falta la variable FIREBASE_SERVICE_ACCOUNT");
      const sa = JSON.parse(raw);
      // Si se pegó con "\n" literales, los convertimos a saltos de línea reales
      if (typeof sa.private_key === "string") sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      app = initializeApp({ credential: cert(sa) });
    }
  }
  return { auth: getAuth(app), db: getFirestore(app), messaging: getMessaging(app) };
}
