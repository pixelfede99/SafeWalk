"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { requestNotificationPermission } from "@/lib/notifications";
import { registerPush } from "@/lib/push";

type Result = { tone: "ok" | "warn" | "bad"; text: string } | null;

const TONE: Record<"ok" | "warn" | "bad", string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400"
};

/**
 * Activar y probar las notificaciones push.
 *
 * Existe porque la push es lo que avisa a la familia con la app cerrada, y
 * cuando no llega no hay ninguna pista de por qué: permiso del navegador,
 * token sin registrar o servidor sin configurar. Esto prueba la cadena entera
 * (navegador -> token FCM -> /api/notify -> FCM -> service worker) y dice en
 * qué eslabón se cortó.
 */
export function PushTestCard({ uid }: { uid: string }) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) setPermission("unsupported");
    else setPermission(Notification.permission);
  }, []);

  const onTest = async () => {
    setBusy(true);
    setResult(null);
    try {
      const perm = await requestNotificationPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setResult({
          tone: "bad",
          text: "El navegador tiene las notificaciones bloqueadas para esta página. Activalas en la configuración del sitio y volvé a probar."
        });
        return;
      }
      const registered = await registerPush(uid);
      if (!registered) {
        setResult({
          tone: "bad",
          text: "No se pudo registrar este dispositivo para recibir avisos (navegador sin soporte o error de Firebase)."
        });
        return;
      }
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ test: true })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 500 && data?.error === "servidor sin configurar") {
        setResult({
          tone: "bad",
          text: "El servidor todavía no puede mandar avisos: falta la variable FIREBASE_SERVICE_ACCOUNT en Vercel (Production) y volver a publicar."
        });
      } else if (!res.ok) {
        setResult({ tone: "bad", text: `El servidor respondió un error (${res.status}).` });
      } else if (data?.sent > 0) {
        setResult({
          tone: "ok",
          text: "Listo: se mandó una notificación de prueba. Si no la ves en unos segundos, revisá que el celular no tenga silenciado el navegador."
        });
      } else {
        setResult({
          tone: "warn",
          text: "El servidor no encontró este dispositivo registrado. Recargá la página y probá de nuevo."
        });
      }
    } catch {
      setResult({ tone: "bad", text: "No hay conexión con el servidor." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-300">
        Estado en este dispositivo:{" "}
        <span className="font-medium">
          {permission === "granted"
            ? "activadas"
            : permission === "denied"
              ? "bloqueadas"
              : permission === "unsupported"
                ? "este navegador no las soporta"
                : "sin activar"}
        </span>
      </p>
      <p className="text-xs text-slate-400">
        Las alertas del bastón te llegan como notificación aunque tengas la app cerrada.
      </p>
      <button
        onClick={onTest}
        disabled={busy || permission === "unsupported"}
        className="text-sm bg-accent hover:bg-accent-bright disabled:opacity-50 text-white rounded-lg px-3 py-2"
      >
        {busy ? "Probando..." : permission === "granted" ? "Probar notificación" : "Activar y probar notificación"}
      </button>
      {result && (
        <p role="status" className={`text-xs ${TONE[result.tone]}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
