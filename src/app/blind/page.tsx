"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useDevice } from "@/hooks/useDevice";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { signOut } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { BatteryIcon } from "@/components/BatteryIcon";
import {
  RING_SECONDS,
  createSosAlert,
  listenCommand,
  ringDevice,
  setUserRole,
  stopRing
} from "@/lib/firestore";
import { getPhoneLocation } from "@/lib/geolocation";
import type { CommandDoc } from "@/types";

export default function BlindPage() {
  return (
    <ProtectedRoute role="blind_user">
      <BlindContent />
    </ProtectedRoute>
  );
}

function BlindContent() {
  const router = useRouter();
  const { user, userDoc } = useAuth();
  const deviceId = userDoc?.deviceId ?? null;
  const { device } = useDevice(deviceId);

  const [switchProgress, setSwitchProgress] = useState(0);
  const [switching, setSwitching] = useState(false);

  // --- Estado del "hacer sonar el bastón" ---
  const [ringToken, setRingToken] = useState<number | null>(null); // el token que pedimos
  const [command, setCommand] = useState<CommandDoc | null>(null); // lo que ve el bastón
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [ringBusy, setRingBusy] = useState(false);

  // --- Estado del SOS de respaldo ---
  const [sosProgress, setSosProgress] = useState(0);
  const [sosBusy, setSosBusy] = useState(false);

  // Mensaje que se anuncia por TTS y se expone en un aria-live para el lector
  // de pantalla (que es, en la práctica, la interfaz real de esta pantalla).
  const [status, setStatus] = useState("");

  const announce = useCallback((text: string) => {
    setStatus(text);
    speak(text);
  }, []);

  useEffect(() => {
    // Anuncia el estado al entrar (el lector de pantalla ya lee los aria-label)
    const msg = device
      ? `Bastón ${device.isOnline ? "conectado" : "desconectado"}, batería al ${device.batteryLevel} por ciento.`
      : "Conectando con el bastón.";
    speak(msg);
  }, [device?.isOnline, device?.batteryLevel]);

  // Escuchamos el doc de órdenes para saber si el bastón confirmó (ackToken).
  useEffect(() => {
    if (!deviceId) return;
    return listenCommand(deviceId, setCommand);
  }, [deviceId]);

  // El bastón confirmó el pedido que hicimos -> avisamos que SÍ está sonando.
  const acked = ringToken !== null && command?.ackToken === ringToken;
  useEffect(() => {
    if (!acked) return;
    announce("El bastón está sonando. Seguí el pitido.");
    if ("vibrate" in navigator) navigator.vibrate(200);
  }, [acked, announce]);

  // Cuenta regresiva local mientras dura el pitido.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const ringing = secondsLeft > 0;

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  // ---------------------------------------------------------------------------
  //  ENCONTRAR EL BASTÓN (acción principal)
  //
  //  Es un tap simple a propósito: hacer sonar el bastón no rompe nada y se
  //  corta solo, así que pedir "mantené apretado" sería fricción sin motivo.
  // ---------------------------------------------------------------------------
  const onRingToggle = async () => {
    if (!deviceId || !user || ringBusy) return;

    if (ringing) {
      setRingBusy(true);
      try {
        await stopRing(deviceId, user.uid);
        setSecondsLeft(0);
        setRingToken(null);
        announce("Listo, el bastón deja de sonar.");
      } catch (err) {
        console.error("Error parando el pitido:", err);
        announce("No se pudo parar. Se corta solo en unos segundos.");
      } finally {
        setRingBusy(false);
      }
      return;
    }

    if (device && !device.isOnline) {
      // El bastón sin WiFi o sin batería no puede sonar: decirlo es más útil
      // que dejar al usuario esperando un pitido que no va a llegar.
      announce(
        `El bastón está desconectado, no puede sonar. ${lastSeenPhrase(device.lastSeen)}`
      );
      return;
    }

    setRingBusy(true);
    try {
      const token = await ringDevice(deviceId, user.uid, RING_SECONDS);
      setRingToken(token);
      setSecondsLeft(RING_SECONDS);
      announce("Pedido enviado. El bastón empieza a pitar en unos segundos.");
    } catch (err) {
      console.error("Error haciendo sonar el bastón:", err);
      announce("No se pudo enviar el pedido. Intentá de nuevo.");
    } finally {
      setRingBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  //  SOS DE RESPALDO (acción secundaria)
  //
  //  El SOS principal es el botón FÍSICO del bastón: es más rápido y además
  //  dispara la foto y el audio del ESP32-CAM. Este es el caso "me separé del
  //  bastón", y por eso manda la ubicación del TELÉFONO, no la del bastón.
  // ---------------------------------------------------------------------------
  const triggerSos = async () => {
    if (!deviceId) {
      announce("Error: no hay un bastón vinculado a esta cuenta.");
      return;
    }
    setSosBusy(true);
    announce("Enviando alerta. Buscando tu ubicación.");
    try {
      const { location, source } = await getPhoneLocation(device?.location ?? null);
      await createSosAlert(deviceId, location, source);
      announce(
        source === "phone"
          ? "Alerta enviada con tu ubicación. Tus familiares fueron notificados."
          : "Alerta enviada. No se pudo obtener tu ubicación, se mandó la última del bastón."
      );
      if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    } catch (err) {
      console.error("Error enviando SOS:", err);
      announce("No se pudo enviar la alerta. Intentá de nuevo.");
    } finally {
      setSosBusy(false);
    }
  };

  const sosHold = useHoldToConfirm(setSosProgress, triggerSos, 2000);
  const switchHold = useHoldToConfirm(setSwitchProgress, confirmSwitchRole, 1500);

  async function confirmSwitchRole() {
    if (!user || switching) return;
    setSwitching(true);
    try {
      speak("Cambiando a modo familiar.");
      await setUserRole(user.uid, "caregiver");
      router.replace("/dashboard");
    } catch (err) {
      console.error("Error cambiando rol:", err);
      announce("Error al cambiar de modo. Intentá de nuevo.");
      setSwitching(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b-4 border-white gap-3">
        <h1 className="text-3xl font-black">SafeWalk</h1>
        <div className="flex items-center gap-3">
          <button
            {...switchHold}
            disabled={switching}
            aria-label="Mantené apretado para cambiar a modo familiar"
            className="relative text-xl font-bold underline overflow-hidden px-3 py-2 disabled:opacity-50"
          >
            Modo familiar
            {switchProgress > 0 && (
              <span
                className="absolute bottom-0 left-0 h-1 bg-white transition-none"
                style={{ width: `${switchProgress}%` }}
              />
            )}
          </button>
          <button onClick={onLogout} aria-label="Cerrar sesión" className="text-xl font-bold underline">
            Salir
          </button>
        </div>
      </header>
      {switchProgress > 0 && switchProgress < 100 && (
        <div className="bg-yellow-400 text-black text-center font-bold text-xl py-2">
          Mantené apretado para cambiar de modo...
        </div>
      )}

      {/* El lector de pantalla anuncia solo cualquier cambio de estado. */}
      <p aria-live="assertive" className="sr-only">
        {status}
      </p>

      <section className="px-6 py-8 space-y-6 border-b-4 border-white">
        <StatusRow
          label="Bastón"
          value={device?.isOnline ? "CONECTADO" : "DESCONECTADO"}
          color={device?.isOnline ? "#10b981" : "#ef4444"}
        />
        <StatusRow
          label="Batería"
          value={`${device?.batteryLevel ?? "—"}%`}
          color="#fff"
          extra={
            device ? (
              <span className="ml-3 inline-flex items-center" aria-hidden>
                <BatteryIcon level={device.batteryLevel} />
              </span>
            ) : null
          }
        />
      </section>

      {/* ---------------- ACCIÓN PRINCIPAL: encontrar el bastón ---------------- */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <p className="text-2xl font-bold mb-6 text-center" aria-hidden>
          {ringing ? "Está sonando" : "¿No encontrás el bastón?"}
        </p>
        <button
          onClick={onRingToggle}
          disabled={ringBusy}
          aria-label={
            ringing
              ? "Parar el pitido del bastón"
              : "Hacer sonar el bastón para encontrarlo. Tocá una vez."
          }
          className={`relative w-72 h-72 rounded-full text-white border-8 border-white flex flex-col items-center justify-center transition-transform duration-150 motion-safe:active:scale-[0.98] disabled:opacity-70 ${
            ringing ? "bg-amber-500 active:bg-amber-600" : "bg-emerald-600 active:bg-emerald-700"
          }`}
          style={{
            boxShadow: ringing
              ? "0 0 0 8px rgba(255,255,255,0.15), 0 20px 60px rgba(245,158,11,0.5)"
              : "0 0 0 8px rgba(255,255,255,0.15), 0 20px 60px rgba(16,185,129,0.5)"
          }}
        >
          {ringing ? (
            <>
              <span className="text-5xl font-black tracking-wide">PARAR</span>
              <span className="mt-2 text-3xl font-bold tabular-nums" aria-hidden>
                {secondsLeft}s
              </span>
            </>
          ) : (
            <span className="text-5xl font-black tracking-wide leading-tight text-center">
              SONAR
              <br />
              BASTÓN
            </span>
          )}
        </button>

        <p className="mt-8 text-xl text-center max-w-md">
          {ringing
            ? acked
              ? "El bastón recibió el pedido y está pitando. Seguí el sonido."
              : "Esperando que el bastón conteste..."
            : "El bastón pita fuerte para que puedas encontrarlo de oído."}
        </p>

        {device && !device.isOnline && (
          <p className="mt-4 text-lg text-center text-amber-300 max-w-md">
            El bastón está desconectado (sin WiFi o sin batería), así que no puede
            sonar. {lastSeenPhrase(device.lastSeen)}
          </p>
        )}
      </section>

      {/* ---------------- ACCIÓN SECUNDARIA: SOS de respaldo ---------------- */}
      <section className="px-6 py-6 border-t-4 border-white">
        <button
          {...sosHold}
          disabled={sosBusy}
          aria-label="Emergencia. Mantené apretado dos segundos para avisar a tu familia."
          className="relative w-full overflow-hidden rounded-2xl bg-red-700 active:bg-red-800 border-4 border-white py-6 disabled:opacity-70"
        >
          <span className="text-4xl font-black tracking-wider">SOS</span>
          <span className="block mt-1 text-lg font-bold" aria-hidden>
            {sosBusy ? "Enviando..." : "Mantené apretado"}
          </span>
          {sosProgress > 0 && (
            <span
              className="absolute bottom-0 left-0 h-2 bg-white transition-none"
              style={{ width: `${sosProgress}%` }}
            />
          )}
        </button>
        <p className="mt-4 text-lg text-center">
          Para una emergencia con el bastón en la mano, usá el botón físico del
          bastón: es más rápido y además saca foto y graba audio.
        </p>
      </section>
    </main>
  );
}

/**
 * Hold-to-confirm reutilizable: llena una barra de progreso durante `durationMs`
 * y recién ahí ejecuta la acción. Evita disparos accidentales en el bolsillo.
 *
 * El intervalo se guarda en un ref (antes vivía en `window`, que se pisaba entre
 * botones y perdía el timer si se desmontaba el componente).
 */
function useHoldToConfirm(
  setProgress: (n: number) => void,
  onConfirm: () => void | Promise<void>,
  durationMs: number
) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const clear = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setProgress(0);
  }, [setProgress]);

  useEffect(() => clear, [clear]);

  const start = useCallback(() => {
    if (timer.current) return;
    const ticks = durationMs / 100;
    let progress = 0;
    timer.current = setInterval(() => {
      progress += 100 / ticks;
      setProgress(Math.min(progress, 100));
      if (progress >= 100) {
        clear();
        void onConfirmRef.current();
      }
    }, 100);
  }, [clear, durationMs, setProgress]);

  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear
  };
}

function lastSeenPhrase(lastSeen?: { toDate?: () => Date }): string {
  const dt = lastSeen?.toDate?.();
  if (!dt) return "No hay datos de dónde estuvo por última vez.";
  const mins = Math.round((Date.now() - dt.getTime()) / 60000);
  if (mins < 1) return "Se lo vio hace menos de un minuto.";
  if (mins < 60) return `Se lo vio por última vez hace ${mins} minutos.`;
  const hours = Math.round(mins / 60);
  return `Se lo vio por última vez hace ${hours} ${hours === 1 ? "hora" : "horas"}.`;
}

function StatusRow({
  label,
  value,
  color,
  extra
}: {
  label: string;
  value: string;
  color: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-2xl font-bold uppercase">{label}</span>
      <span className="text-4xl font-black flex items-center" style={{ color }}>
        {value}
        {extra}
      </span>
    </div>
  );
}

function speak(text: string) {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-AR";
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
