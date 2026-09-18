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
import { isDeviceOnline } from "@/lib/device-status";
import { useNow } from "@/hooks/useNow";
import type { CommandDoc } from "@/types";

/**
 * Cuánto hay que mantener apretado para disparar el SOS.
 *
 * 3 s es a propósito más que el típico long-press de 500 ms: este botón ocupa
 * toda la pantalla, así que un roce largo no puede terminar mandándole una
 * emergencia a la familia. Y le da tiempo al usuario de soltar cuando escucha
 * el aviso.
 */
const SOS_HOLD_MS = 3000;

/** Antes de esto el gesto se siente como un tap común y no decimos nada. */
const HOLD_FEEDBACK_MS = 600;

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

  // OJO: no usamos device.isOnline directo. Ese campo solo se escribe en true,
  // así que un bastón apagado figuraba "CONECTADO" para siempre (ver
  // lib/device-status.ts). El tick del reloj es lo que hace que la pantalla
  // pase sola a "DESCONECTADO" cuando dejan de llegar heartbeats.
  const now = useNow();
  const online = isDeviceOnline(device, now);

  const [switchProgress, setSwitchProgress] = useState(0);
  const [switching, setSwitching] = useState(false);

  // --- Estado del "hacer sonar el bastón" ---
  const [ringToken, setRingToken] = useState<number | null>(null); // el token que pedimos
  const [command, setCommand] = useState<CommandDoc | null>(null); // lo que ve el bastón
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [ringBusy, setRingBusy] = useState(false);

  // --- Estado del SOS (ahora es el mismo botón, mantenido apretado) ---
  const [holdMs, setHoldMs] = useState(0);
  const [sosBusy, setSosBusy] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Un "mantener apretado" CONTIENE un tap: al soltar siempre llega el evento de
  // release. Esta bandera es la que evita que, después de disparar el SOS (o de
  // cancelar el gesto), soltar el dedo haga sonar el bastón encima.
  const suppressTapRef = useRef(false);
  const holdAnnouncedRef = useRef(false);
  // Los navegadores móviles emulan eventos de mouse después de un touch. Sin
  // esta bandera, un solo toque llegaría dos veces (touch + mouse emulado) y el
  // bastón empezaría a sonar y se pararía solo al instante.
  const touchActiveRef = useRef(false);

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
      ? `Bastón ${online ? "conectado" : "desconectado"}, batería al ${device.batteryLevel} por ciento.`
      : "Conectando con el bastón.";
    speak(msg);
  }, [online, device?.batteryLevel]);

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
  // Recién mostramos el SOS cuando el gesto dejó de parecer un tap.
  const holding = holdMs >= HOLD_FEEDBACK_MS;

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

    if (device && !online) {
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

  // ---------------------------------------------------------------------------
  //  UN SOLO GESTO PARA TODA LA PANTALLA
  //
  //  Tocar  -> hacer sonar el bastón (o pararlo si ya está sonando)
  //  Mantener -> SOS
  //
  //  La idea es que el usuario no tenga que BUSCAR nada: toda el área central es
  //  el botón, así que toca en cualquier lado y funciona. Dos botones separados
  //  obligaban a acertarle a uno de los dos sin verlos.
  // ---------------------------------------------------------------------------
  const clearHold = useCallback(() => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHoldMs(0);
  }, []);

  useEffect(() => clearHold, [clearHold]);

  const onPressStart = (fromTouch: boolean) => {
    if (fromTouch) touchActiveRef.current = true;
    else if (touchActiveRef.current) return;   // mouse emulado tras un touch
    if (holdTimer.current || sosBusy || ringBusy) {
      suppressTapRef.current = true;   // soltar no dispara nada
      return;
    }
    suppressTapRef.current = false;
    holdAnnouncedRef.current = false;
    const startedAt = Date.now();
    let lastPulse = 0;

    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setHoldMs(elapsed);

      // Hasta HOLD_FEEDBACK_MS el gesto se siente como un tap común y no
      // anunciamos nada, para no hablarle encima a cada toque.
      if (elapsed >= HOLD_FEEDBACK_MS && !holdAnnouncedRef.current) {
        holdAnnouncedRef.current = true;
        speak("Seguí apretando para pedir ayuda. Soltá para hacer sonar el bastón.");
      }
      // Un pulso de vibración por segundo: le dice al usuario que el gesto va
      // avanzando y cuánto le falta, sin depender de la pantalla.
      if (elapsed >= HOLD_FEEDBACK_MS && elapsed - lastPulse >= 1000) {
        lastPulse = elapsed;
        if ("vibrate" in navigator) navigator.vibrate(60);
      }
      if (elapsed >= SOS_HOLD_MS) {
        suppressTapRef.current = true;   // soltar ya no hace sonar el bastón
        clearHold();
        void triggerSos();
      }
    }, 50);
  };

  /** El mouse emulado llega ~300 ms después del touch; lo ignoramos por 700 ms. */
  const touchGuardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseTouchGuard = () => {
    if (touchGuardTimer.current) clearTimeout(touchGuardTimer.current);
    touchGuardTimer.current = setTimeout(() => {
      touchActiveRef.current = false;
      touchGuardTimer.current = null;
    }, 700);
  };

  const onPressEnd = (fromTouch: boolean) => {
    if (!fromTouch && touchActiveRef.current) return;   // mouse emulado tras un touch
    const suppressed = suppressTapRef.current;
    clearHold();
    if (fromTouch) releaseTouchGuard();
    if (suppressed) return;
    void onRingToggle();
  };

  // El dedo/mouse se fue del botón: cancelamos sin disparar nada. Sin esto, un
  // gesto abortado terminaría haciendo sonar el bastón al soltar.
  const onPressCancel = (fromTouch: boolean) => {
    if (!fromTouch && touchActiveRef.current) return;
    suppressTapRef.current = true;
    clearHold();
    if (fromTouch) releaseTouchGuard();
  };

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
          value={online ? "CONECTADO" : "DESCONECTADO"}
          color={online ? "#10b981" : "#ef4444"}
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

      {/* ------------------------------------------------------------------
          UN SOLO BOTÓN, TODA EL ÁREA CENTRAL.
          Tocar = sonar el bastón. Mantener apretado = SOS.
          El usuario no tiene que acertarle a nada: toca donde sea.
         ------------------------------------------------------------------ */}
      <section className="flex-1 flex flex-col">
        <button
          onTouchStart={() => onPressStart(true)}
          onTouchEnd={() => onPressEnd(true)}
          onTouchCancel={() => onPressCancel(true)}
          onMouseDown={() => onPressStart(false)}
          onMouseUp={() => onPressEnd(false)}
          onMouseLeave={() => onPressCancel(false)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={
            ringing
              ? "Tocá para parar el pitido del bastón. Mantené apretado tres segundos para pedir ayuda."
              : "Tocá para hacer sonar el bastón y encontrarlo. Mantené apretado tres segundos para pedir ayuda."
          }
          className={`flex-1 w-full flex flex-col items-center justify-center gap-4 px-6 py-10 transition-colors duration-150 select-none touch-none ${
            sosBusy ? "bg-red-900" : holding ? "bg-red-800" : ringing ? "bg-amber-600" : "bg-emerald-700"
          }`}
        >
          {holding ? (
            <>
              <span className="text-6xl font-black tracking-wide">SOS</span>
              <span className="text-3xl font-bold">Seguí apretando</span>
              {/* Barra gorda: el progreso también tiene que verse de reojo para
                  quien conserva algo de visión. */}
              <span className="w-64 h-6 bg-white/25 rounded-full overflow-hidden" aria-hidden>
                <span
                  className="block h-full bg-white transition-none"
                  style={{ width: `${Math.min((holdMs / SOS_HOLD_MS) * 100, 100)}%` }}
                />
              </span>
              <span className="text-2xl font-bold tabular-nums" aria-hidden>
                {Math.max(Math.ceil((SOS_HOLD_MS - holdMs) / 1000), 0)}
              </span>
            </>
          ) : sosBusy ? (
            <span className="text-5xl font-black tracking-wide">ENVIANDO...</span>
          ) : ringing ? (
            <>
              <span className="text-6xl font-black tracking-wide">PARAR</span>
              <span className="text-3xl font-bold tabular-nums" aria-hidden>
                {secondsLeft}s
              </span>
            </>
          ) : (
            <>
              <span className="text-6xl font-black tracking-wide leading-tight text-center">
                SONAR
                <br />
                BASTÓN
              </span>
              <span className="text-2xl font-bold opacity-90 text-center" aria-hidden>
                Tocá en cualquier lado
              </span>
            </>
          )}
        </button>

        <div className="px-6 py-5 border-t-4 border-white space-y-2">
          <p className="text-xl text-center">
            {ringing
              ? acked
                ? "El bastón recibió el pedido y está pitando. Seguí el sonido."
                : "Esperando que el bastón conteste..."
              : "Tocá para que el bastón pite. Mantené apretado para pedir ayuda."}
          </p>
          {device && !online && (
            <p className="text-lg text-center text-amber-300">
              El bastón está desconectado, así que no puede sonar.{" "}
              {lastSeenPhrase(device.lastSeen)}
            </p>
          )}
        </div>
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
