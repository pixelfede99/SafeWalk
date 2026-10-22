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
import { registerPush } from "@/lib/push";
import { seedDemoAlert } from "@/lib/demo";
import {
  DEFAULT_MAP_CENTER,
  TONE_CLASS,
  alertTriggerLabel,
  deviceLocationNote,
  hasRealLocation
} from "@/lib/location";

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

  // Pedimos permiso de notificaciones y registramos el push (FCM) para que las
  // alertas lleguen también con la app cerrada.
  useEffect(() => {
    if (!user) return;
    requestNotificationPermission().then((perm) => {
      if (perm === "granted") registerPush(user.uid);
    });
  }, [user]);

  // Cuando llega una alerta nueva, mostramos notificaci&#243;n del SO
  useEffect(() => {
    if (hasNew && alert) {
      showLocalNotification("¡Alerta de SafeWalk!", {
        body: `${alertTriggerLabel(alert)}: revisá la app.`,
        tag: alert.id,
        requireInteraction: true
      });
    }
  }, [hasNew, alert]);

  // Sin ubicación real (0,0) centramos en Buenos Aires pero SIN marcador: antes
  // el bastón aparecía en el Obelisco como si estuviera ahí.
  const hasLocation = hasRealLocation(device?.location);
  const center = hasLocation ? device!.location : DEFAULT_MAP_CENTER;
  const locationNote = deviceLocationNote(device);

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

      <main className="flex-1 flex flex-col max-w-5xl w-full mx-auto px-4 py-4 space-y-4">
        <div className="relative h-[55vh] w-full rounded-2xl overflow-hidden border border-white/5">
          <Map
            center={center}
            trail={trail}
            showMarker={hasLocation}
            staleMarker={device?.gpsFix === false}
            zoom={hasLocation ? 16 : 11}
          />
          {/* left-14: a la derecha de los botones de zoom de Leaflet, que si no
              quedan tapados en el celular. */}
          {locationNote && (
            <div
              role="status"
              className={`absolute top-3 left-14 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-full max-w-md text-center bg-bg-card/95 border border-white/10 rounded-xl px-3 py-2 text-xs z-[400] animate-fade-in ${TONE_CLASS[locationNote.tone]}`}
            >
              {locationNote.text}
            </div>
          )}
          {paused && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-bg-card/95 border border-white/10 rounded-full px-4 py-2 text-xs text-slate-300 z-[400] animate-fade-in">
              Actualizaciones pausadas (pestaña en segundo plano)
            </div>
          )}
        </div>

        <DevicePanel device={device} />

        {alert && !hasNew && (
          <PreviousAlertCard alertId={alert.id} when={alert.timestamp?.toDate?.()} />
        )}
      </main>

      {isDemoDevice && (
        <button
          onClick={onSimulateAlert}
          className="fixed bottom-5 right-5 z-40 bg-danger hover:bg-danger/90 text-white font-semibold rounded-full shadow-2xl shadow-danger/50 px-5 py-3 flex items-center gap-2 transition-transform duration-150 motion-safe:active:scale-95"
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
    <div className="bg-bg-card border border-white/5 rounded-2xl p-4 animate-fade-rise">
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
