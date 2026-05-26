"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useDevice } from "@/hooks/useDevice";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { signOut } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { BatteryIcon } from "@/components/BatteryIcon";
import { createSosAlert, setUserRole } from "@/lib/firestore";

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
  const { device } = useDevice(userDoc?.deviceId);
  const [holdProgress, setHoldProgress] = useState(0);
  const [switchProgress, setSwitchProgress] = useState(0);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    // Anuncia el estado por TTS al entrar (lectores de pantalla ya leen el aria-label)
    const msg = device
      ? `Bastón ${device.isOnline ? "conectado" : "desconectado"}, batería al ${device.batteryLevel} por ciento.`
      : "Conectando con el bastón.";
    speak(msg);
  }, [device?.isOnline, device?.batteryLevel]);

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  // Hold-to-confirm de 1.5s para evitar cambios accidentales
  const onSwitchHoldStart = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 100 / 15; // 100% en 1.5s (15 ticks de 100ms)
      setSwitchProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        confirmSwitchRole();
      }
    }, 100);
    (window as Window & { _switchInterval?: number })._switchInterval = interval as unknown as number;
  };

  const onSwitchHoldEnd = () => {
    const w = window as Window & { _switchInterval?: number };
    if (w._switchInterval) clearInterval(w._switchInterval);
    setSwitchProgress(0);
  };

  const confirmSwitchRole = async () => {
    if (!user || switching) return;
    setSwitching(true);
    try {
      speak("Cambiando a modo familiar.");
      await setUserRole(user.uid, "caregiver");
      router.replace("/dashboard");
    } catch (err) {
      console.error("Error cambiando rol:", err);
      speak("Error al cambiar de modo. Intentá de nuevo.");
      setSwitching(false);
    }
  };

  // El SOS de la PWA es secundario; el principal est&#225; en el bot&#243;n f&#237;sico del bast&#243;n.
  // Igual lo incluimos como respaldo - hold-to-confirm para evitar pulsaciones accidentales.
  const onSosHoldStart = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        triggerSos();
      }
    }, 100);
    (window as Window & { _sosInterval?: number })._sosInterval = interval as unknown as number;
  };

  const onSosHoldEnd = () => {
    const w = window as Window & { _sosInterval?: number };
    if (w._sosInterval) clearInterval(w._sosInterval);
    setHoldProgress(0);
  };

  const triggerSos = async () => {
    if (!device) {
      speak("Error: el bastón no está conectado.");
      return;
    }
    try {
      const loc = device.location?.lat ? device.location : { lat: 0, lng: 0 };
      await createSosAlert(device.deviceId, loc);
      speak("Alerta enviada. Tus familiares fueron notificados.");
      if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    } catch (err) {
      console.error("Error enviando SOS:", err);
      speak("No se pudo enviar la alerta. Intentá de nuevo.");
    }
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b-4 border-white gap-3">
        <h1 className="text-3xl font-black">SafeWalk</h1>
        <div className="flex items-center gap-3">
          <button
            onTouchStart={onSwitchHoldStart}
            onTouchEnd={onSwitchHoldEnd}
            onMouseDown={onSwitchHoldStart}
            onMouseUp={onSwitchHoldEnd}
            onMouseLeave={onSwitchHoldEnd}
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
          <button
            onClick={onLogout}
            aria-label="Cerrar sesión"
            className="text-xl font-bold underline"
          >
            Salir
          </button>
        </div>
      </header>
      {switchProgress > 0 && switchProgress < 100 && (
        <div className="bg-yellow-400 text-black text-center font-bold text-xl py-2">
          Mantené apretado para cambiar de modo...
        </div>
      )}

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

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <p className="text-2xl font-bold mb-6 text-center" aria-hidden>
          Mantené apretado para SOS
        </p>
        <button
          onTouchStart={onSosHoldStart}
          onTouchEnd={onSosHoldEnd}
          onMouseDown={onSosHoldStart}
          onMouseUp={onSosHoldEnd}
          onMouseLeave={onSosHoldEnd}
          aria-label="Botón de emergencia. Mantenelo apretado para enviar alerta."
          className="relative w-72 h-72 rounded-full bg-red-600 active:bg-red-700 text-white border-8 border-white flex items-center justify-center"
          style={{
            boxShadow: "0 0 0 8px rgba(255,255,255,0.15), 0 20px 60px rgba(239,68,68,0.5)"
          }}
        >
          <span className="text-7xl font-black tracking-wider">SOS</span>
          {holdProgress > 0 && (
            <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                stroke="white"
                strokeWidth="4"
                fill="none"
                strokeDasharray={`${(holdProgress * 2.89).toFixed(2)} 1000`}
              />
            </svg>
          )}
        </button>
        <p className="mt-8 text-xl text-center max-w-md">
          El botón físico del bastón también funciona en cualquier momento.
        </p>
      </section>
    </main>
  );
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
