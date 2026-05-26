"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useDevice } from "@/hooks/useDevice";
import { useLatestAlert } from "@/hooks/useAlerts";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TopBar } from "@/components/TopBar";
import { DevicePanel } from "@/components/DevicePanel";
import { AlertBanner } from "@/components/AlertBanner";
import { markAlertSeen } from "@/lib/firestore";
import { requestNotificationPermission, showLocalNotification } from "@/lib/notifications";
import { seedDemoAlert } from "@/lib/demo";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function DashboardPage() {
  return (
    <ProtectedRoute role="caregiver">
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { user, userDoc } = useAuth();
  const deviceId = userDoc?.deviceId ?? null;
  const { device, trail, paused } = useDevice(deviceId);
  const { alert, hasNew, dismissNew } = useLatestAlert(deviceId);

  // Pedimos permiso de notificaciones la primera vez
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Cuando llega una alerta nueva, mostramos notificaci&#243;n del SO
  useEffect(() => {
    if (hasNew && alert) {
      showLocalNotification("¡Alerta de SafeWalk!", {
        body: "Tu familiar presionó el botón de emergencia.",
        tag: alert.id,
        requireInteraction: true
      });
    }
  }, [hasNew, alert]);

  const center = device?.location?.lat
    ? device.location
    : { lat: -34.6037, lng: -58.3816 }; // Buenos Aires por defecto

  const onDismissAlert = async () => {
    if (alert && user) {
      await markAlertSeen(alert.id, user.uid);
    }
    dismissNew();
  };

  const isDemoDevice = deviceId?.startsWith("demo-") ?? false;
  const onSimulateAlert = async () => {
    if (!deviceId) return;
    await seedDemoAlert(deviceId);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="SafeWalk" />

      {hasNew && alert && <AlertBanner alert={alert} onDismiss={onDismissAlert} />}

      <main className="flex-1 flex flex-col">
        <div className="relative h-[60vh] w-full">
          <Map center={center} trail={trail} />
          {paused && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-bg-card/95 border border-white/10 rounded-full px-4 py-2 text-xs text-slate-300 z-[400]">
              Actualizaciones pausadas (pestaña en segundo plano)
            </div>
          )}
        </div>

        <section className="p-4 space-y-4 max-w-5xl w-full mx-auto">
          <DevicePanel device={device} />

          {alert && !hasNew && (
            <PreviousAlertCard alertId={alert.id} when={alert.timestamp?.toDate?.()} />
          )}
        </section>
      </main>

      {isDemoDevice && (
        <button
          onClick={onSimulateAlert}
          className="fixed bottom-5 right-5 z-40 bg-danger hover:bg-danger/90 text-white font-semibold rounded-full shadow-2xl shadow-danger/50 px-5 py-3 flex items-center gap-2"
          title="Crea una alerta de prueba para ver el banner de emergencia"
        >
          <span className="text-lg">🚨</span> Simular alerta
        </button>
      )}
    </div>
  );
}

function PreviousAlertCard({ when }: { alertId: string; when?: Date }) {
  return (
    <div className="bg-bg-card border border-white/5 rounded-2xl p-4">
      <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Última alerta</p>
      <p className="text-sm">
        {when ? when.toLocaleString("es-AR") : "—"}{" "}
        <a href="/alerts" className="text-accent-glow hover:underline ml-2">
          Ver historial
        </a>
      </p>
    </div>
  );
}
