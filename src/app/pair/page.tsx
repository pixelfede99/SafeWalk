"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createDevice, setUserDevice, joinDeviceByCode } from "@/lib/firestore";
import { isWebBluetoothSupported, requestSafeWalkDevice } from "@/lib/bluetooth";
import { seedDemoDevice } from "@/lib/demo";

type Step = "intro" | "scanning" | "found" | "manual" | "join" | "linking" | "done";

export default function PairPage() {
  const router = useRouter();
  const { user, userDoc, loading } = useAuth();
  const [step, setStep] = useState<Step>("intro");
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<{ id: string; name: string } | null>(null);
  const [manualId, setManualId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [bluetoothSupported, setBluetoothSupported] = useState(true);

  useEffect(() => {
    setBluetoothSupported(isWebBluetoothSupported());
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Si ya tiene dispositivo emparejado, no deberíamos estar acá
  useEffect(() => {
    if (userDoc?.deviceId) {
      router.replace(userDoc.role === "blind_user" ? "/blind" : "/dashboard");
    }
  }, [userDoc, router]);

  const startScan = async () => {
    setError(null);
    setStep("scanning");
    try {
      const dev = await requestSafeWalkDevice();
      setScanned(dev);
      setStep("found");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("User cancelled") || msg.toLowerCase().includes("cancel")) {
        setStep("intro");
        return;
      }
      setError(msg || "No pudimos buscar dispositivos");
      setStep("intro");
    }
  };

  const onJoinByCode = async () => {
    if (!user || !joinCode.trim()) return;
    setError(null);
    setStep("linking");
    try {
      await joinDeviceByCode(user.uid, joinCode);
      setStep("done");
      setTimeout(() => {
        router.replace(userDoc?.role === "blind_user" ? "/blind" : "/dashboard");
      }, 800);
    } catch (err) {
      setError((err as Error).message);
      setStep("join");
    }
  };

  const startDemo = async () => {
    if (!user) return;
    setError(null);
    setStep("linking");
    try {
      const deviceId = await seedDemoDevice(user.uid);
      await setUserDevice(user.uid, deviceId);
      setStep("done");
      setTimeout(() => {
        router.replace(userDoc?.role === "blind_user" ? "/blind" : "/dashboard");
      }, 800);
    } catch (err) {
      setError((err as Error).message);
      setStep("intro");
    }
  };

  const linkDevice = async (deviceId: string, name: string, bluetoothId?: string) => {
    if (!user) return;
    setStep("linking");
    try {
      await createDevice(deviceId, user.uid, name, bluetoothId);
      await setUserDevice(user.uid, deviceId);
      setStep("done");
      setTimeout(() => {
        router.replace(userDoc?.role === "blind_user" ? "/blind" : "/dashboard");
      }, 800);
    } catch (err) {
      setError((err as Error).message);
      setStep("intro");
    }
  };

  const onConfirmFound = () => {
    if (!scanned) return;
    // El deviceId que usamos en Firestore es el mismo identificador que graba el ESP32.
    // Para el demo escolar el ESP32 publica su MAC/serial: lo pedimos al usuario tambi&#233;n.
    setStep("manual");
  };

  const onManualSubmit = async () => {
    if (!manualId.trim()) return;
    const id = manualId.trim();
    const name = scanned?.name ?? `SafeWalk-${id.slice(0, 4)}`;
    await linkDevice(id, name, scanned?.id);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        {step === "intro" && (
          <div className="text-center">
            <BluetoothIcon className="w-20 h-20 text-accent mx-auto mb-6" />
            <h1 className="text-3xl font-bold mb-3">Emparejá tu bastón</h1>
            <p className="text-slate-400 mb-8">
              Asegurate de que el bastón SafeWalk esté encendido y cerca tuyo.
            </p>

            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 text-sm mb-4">
                {error}
              </div>
            )}

            {bluetoothSupported ? (
              <button
                onClick={startScan}
                className="w-full bg-accent hover:bg-accent-bright text-white font-semibold py-4 rounded-xl mb-3"
              >
                Buscar bastón por Bluetooth
              </button>
            ) : (
              <div className="bg-warning/10 border border-warning/30 text-warning rounded-lg p-3 text-sm mb-4">
                Tu navegador no soporta Bluetooth Web. Vas a tener que ingresar el ID manualmente.
              </div>
            )}

            <button
              onClick={() => setStep("join")}
              className="w-full bg-bg-card hover:bg-bg-elevated border border-accent/30 text-white font-medium py-4 rounded-xl mb-3"
            >
              🔗 Unirme a un círculo con código
            </button>

            <button
              onClick={() => setStep("manual")}
              className="w-full bg-bg-card hover:bg-bg-elevated border border-white/10 text-white font-medium py-4 rounded-xl mb-3"
            >
              Ingresar ID del bastón manualmente
            </button>

            <div className="my-6 flex items-center gap-3 text-xs text-slate-500">
              <div className="flex-1 h-px bg-white/10" />
              <span>o sin bastón físico</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <button
              onClick={startDemo}
              className="w-full bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent-glow font-medium py-4 rounded-xl"
            >
              🧪 Probar con bastón de demo
            </button>
            <p className="text-xs text-slate-500 mt-2">
              Crea un dispositivo simulado con ubicación, batería y recorrido. Ideal para probar la app antes de tener el ESP32.
            </p>
          </div>
        )}

        {step === "scanning" && (
          <div className="text-center">
            <div className="relative w-32 h-32 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-accent/20 animate-ping-slow" />
              <div className="absolute inset-4 rounded-full bg-accent/30 animate-pulse-slow" />
              <div className="relative w-full h-full flex items-center justify-center">
                <BluetoothIcon className="w-12 h-12 text-accent-glow" />
              </div>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Buscando dispositivos...</h2>
            <p className="text-slate-400">Aceptá el cuadro de diálogo del navegador.</p>
          </div>
        )}

        {step === "found" && scanned && (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-success/20 border border-success/40 mx-auto mb-6 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-success" fill="none" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">¡Lo encontramos!</h2>
            <p className="text-slate-400 mb-1">{scanned.name}</p>
            <p className="text-slate-500 text-xs mb-8">{scanned.id}</p>

            <button
              onClick={onConfirmFound}
              className="w-full bg-accent hover:bg-accent-bright text-white font-semibold py-4 rounded-xl mb-3"
            >
              Continuar
            </button>
            <button
              onClick={() => setStep("intro")}
              className="w-full text-slate-400 hover:text-white py-2"
            >
              Buscar otro dispositivo
            </button>
          </div>
        )}

        {step === "manual" && (
          <div>
            <h2 className="text-2xl font-bold mb-3">ID del bastón</h2>
            <p className="text-slate-400 mb-6 text-sm">
              Ingresá el ID que aparece en el firmware del bastón (lo configurás vos en el ESP32).
              Este es el identificador que vincula tu cuenta con los datos en la nube.
            </p>
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="ej. safewalk-001"
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 text-white mb-4 focus:outline-none focus:border-accent"
            />
            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 text-sm mb-4">
                {error}
              </div>
            )}
            <button
              onClick={onManualSubmit}
              disabled={!manualId.trim()}
              className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 text-white font-semibold py-4 rounded-xl mb-3"
            >
              Vincular bastón
            </button>
            <button onClick={() => setStep("intro")} className="w-full text-slate-400 hover:text-white py-2">
              Volver
            </button>
          </div>
        )}

        {step === "join" && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Unirme a un círculo</h2>
            <p className="text-slate-400 mb-6 text-sm">
              Ingresá el código de 6 letras que te compartió tu familiar.
              Lo sacan desde su Cuenta → Mi círculo.
            </p>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC234"
              maxLength={6}
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 text-white text-center text-2xl font-mono tracking-widest mb-4 focus:outline-none focus:border-accent"
            />
            {error && (
              <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 text-sm mb-4">
                {error}
              </div>
            )}
            <button
              onClick={onJoinByCode}
              disabled={joinCode.length < 6}
              className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 text-white font-semibold py-4 rounded-xl mb-3"
            >
              Unirme al círculo
            </button>
            <button onClick={() => setStep("intro")} className="w-full text-slate-400 hover:text-white py-2">
              Volver
            </button>
          </div>
        )}

        {step === "linking" && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full border-4 border-accent border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-slate-300">Vinculando con tu cuenta...</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">¡Listo!</h2>
            <p className="text-slate-400">Llevándote a tu panel...</p>
          </div>
        )}
      </div>
    </main>
  );
}

function BluetoothIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11" />
    </svg>
  );
}
