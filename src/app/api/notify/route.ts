// POST /api/notify  { alertId }   (Authorization: Bearer <idToken de Firebase>)
//
// Manda la notificación push (FCM) de una alerta a todos los usuarios vinculados al
// bastón (dueño + cuidadores), para que llegue aunque la app esté cerrada.
// La llama el DevKit apenas crea la alerta, y la PWA cuando se usa el SOS de respaldo.
// Reemplaza a una Cloud Function (que exige plan Blaze): esto corre gratis en Vercel.
//
// POST /api/notify  { test: true }  -> push de prueba SOLO a los dispositivos del
//   usuario que la pide (botón "Probar notificación" de la cuenta). Sirve para
//   verificar la cadena FCM + service worker sin necesitar el bastón.
//
// GET /api/notify -> diagnóstico: si el servidor tiene la cuenta de servicio
//   cargada. No devuelve ningún secreto, solo sí/no y el motivo.

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdmin } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Errores de FCM que significan "este token ya no sirve" -> lo borramos.
const DEAD_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument"
]);

// Texto según qué disparó la alerta. Una caída y un botón no son lo mismo para
// quien recibe el aviso: la caída puede significar que la persona no puede hablar.
function alertBody(alert: FirebaseFirestore.DocumentData, deviceName: string): string {
  let text: string;
  if (alert.source === "pwa_sos") text = `Pidieron ayuda desde la app de ${deviceName}.`;
  else if (alert.trigger === "caida") text = `Se detectó una CAÍDA en ${deviceName}.`;
  else if (alert.trigger === "prueba") text = `Alerta de PRUEBA de ${deviceName} (no es una emergencia real).`;
  else text = `Apretaron el botón de emergencia de ${deviceName}.`;

  // Que la familia sepa desde la notificación si va a encontrar un mapa o no.
  const loc = alert.location as { lat?: number; lng?: number } | undefined;
  const noLocation = alert.locationSource === "unknown" || !loc || (loc.lat === 0 && loc.lng === 0);
  if (noLocation) text += " Sin ubicación GPS.";
  else if (alert.locationSource === "device_last") text += " Con la última ubicación conocida.";
  return text;
}

export async function GET() {
  try {
    getAdmin();
    return NextResponse.json({ configured: true });
  } catch (err) {
    return NextResponse.json(
      { configured: false, reason: err instanceof Error ? err.message : "error desconocido" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const authz = req.headers.get("authorization") ?? "";
  const idToken = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!idToken) return NextResponse.json({ error: "sin token" }, { status: 401 });

  let admin;
  try {
    admin = getAdmin();
  } catch (err) {
    console.error("[notify]", err);
    return NextResponse.json({ error: "servidor sin configurar" }, { status: 500 });
  }
  const { auth, db, messaging } = admin;

  let callerUid: string;
  try {
    callerUid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // ---- Push de prueba: solo a quien la pidió ----
  if (body?.test === true) {
    const snap = await db.doc(`users/${callerUid}`).get();
    const tokens = ((snap.get("fcmTokens") as string[] | undefined) ?? []).filter(Boolean);
    if (tokens.length === 0) return NextResponse.json({ sent: 0, reason: "sin-tokens" });
    const res = await messaging.sendEachForMulticast({
      tokens,
      data: {
        alertId: `test-${Date.now()}`,
        title: "Prueba de SafeWalk",
        body: "Si ves esto, las alertas te van a llegar aunque la app esté cerrada.",
        url: "/account"
      },
      webpush: { headers: { Urgency: "high", TTL: "600" } }
    });
    await removeDeadTokens(db, res.responses, tokens.map((t) => [t, callerUid]));
    return NextResponse.json({ sent: res.successCount, failed: res.failureCount });
  }

  const alertId = typeof body?.alertId === "string" ? body.alertId : "";
  if (!alertId) return NextResponse.json({ error: "falta alertId" }, { status: 400 });

  // Marcamos la alerta como notificada en una transacción: si el DevKit reintenta
  // o llaman dos veces, no se manda el push repetido.
  const alertRef = db.doc(`alerts/${alertId}`);
  const alert = await db.runTransaction(async (tx) => {
    const snap = await tx.get(alertRef);
    if (!snap.exists || snap.get("notified") === true) return null;
    tx.update(alertRef, { notified: true });
    return snap.data()!;
  });
  if (!alert) return NextResponse.json({ sent: 0, skipped: true });

  const devSnap = await db.doc(`devices/${alert.deviceId}`).get();
  if (!devSnap.exists) return NextResponse.json({ sent: 0 });
  const dev = devSnap.data()!;

  const uids = [...new Set([dev.ownerUid, ...(dev.caregiverUids ?? [])].filter(Boolean))] as string[];
  const tokenOwner = new Map<string, string>();
  const userSnaps = await Promise.all(uids.map((uid) => db.doc(`users/${uid}`).get()));
  for (const snap of userSnaps) {
    for (const t of (snap.get("fcmTokens") as string[] | undefined) ?? []) tokenOwner.set(t, snap.id);
  }
  const tokens = [...tokenOwner.keys()];
  if (tokens.length === 0) return NextResponse.json({ sent: 0, reason: "sin-tokens" });

  const deviceName = dev.name || "el bastón";
  // Mensaje solo-data: el service worker (public/sw.js) arma la notificación.
  let res;
  try {
    res = await messaging.sendEachForMulticast({
      tokens,
      data: {
        alertId,
        title: "¡Alerta de SafeWalk!",
        body: alertBody(alert, deviceName),
        url: "/dashboard"
      },
      webpush: { headers: { Urgency: "high", TTL: "3600" } }
    });
  } catch (err) {
    // FCM no respondió: desmarcamos la alerta para que un reintento (el bastón
    // reintenta ante 5xx) la pueda mandar. Si no, quedaba "notificada" sin push.
    console.error("[notify] FCM falló:", err);
    await alertRef.update({ notified: false }).catch(() => undefined);
    return NextResponse.json({ error: "fcm no respondió" }, { status: 502 });
  }

  await removeDeadTokens(db, res.responses, [...tokenOwner.entries()]);

  return NextResponse.json({ sent: res.successCount, failed: res.failureCount });
}

// Limpieza de tokens que FCM rechazó. `owners` va en el mismo orden que los tokens
// enviados: [token, uid].
async function removeDeadTokens(
  db: FirebaseFirestore.Firestore,
  responses: { success: boolean; error?: { code?: string } }[],
  owners: [string, string][]
) {
  await Promise.all(
    responses.map((r, i) => {
      if (r.success || !DEAD_TOKEN_ERRORS.has(r.error?.code ?? "")) return null;
      const [token, uid] = owners[i];
      return db.doc(`users/${uid}`).update({ fcmTokens: FieldValue.arrayRemove(token) });
    })
  );
}
