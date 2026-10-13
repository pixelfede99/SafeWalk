// POST /api/notify  { alertId }   (Authorization: Bearer <idToken de Firebase>)
//
// Manda la notificación push (FCM) de una alerta a todos los usuarios vinculados al
// bastón (dueño + cuidadores), para que llegue aunque la app esté cerrada.
// La llama el DevKit apenas crea la alerta, y la PWA cuando se usa el SOS de respaldo.
// Reemplaza a una Cloud Function (que exige plan Blaze): esto corre gratis en Vercel.

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

  try {
    await auth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
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
  if (tokens.length === 0) return NextResponse.json({ sent: 0 });

  const deviceName = dev.name || "el bastón";
  // Mensaje solo-data: el service worker (public/sw.js) arma la notificación.
  const res = await messaging.sendEachForMulticast({
    tokens,
    data: {
      alertId,
      title: "¡Alerta de SafeWalk!",
      body: `Se activó una alerta de emergencia en ${deviceName}.`,
      url: "/dashboard"
    },
    webpush: { headers: { Urgency: "high", TTL: "3600" } }
  });

  // Limpieza de tokens que FCM rechazó
  await Promise.all(
    res.responses.map((r, i) => {
      if (r.success || !DEAD_TOKEN_ERRORS.has(r.error?.code ?? "")) return null;
      const t = tokens[i];
      return db.doc(`users/${tokenOwner.get(t)}`).update({ fcmTokens: FieldValue.arrayRemove(t) });
    })
  );

  return NextResponse.json({ sent: res.successCount, failed: res.failureCount });
}
