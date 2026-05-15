"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { format, isSameDay, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useAuth } from "@/context/AuthContext";
import { useAlertHistory } from "@/hooks/useAlerts";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TopBar } from "@/components/TopBar";
import { downloadFile } from "@/lib/storage";
import type { AlertDoc } from "@/types";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function AlertsPage() {
  return (
    <ProtectedRoute role="caregiver">
      <AlertsContent />
    </ProtectedRoute>
  );
}

function AlertsContent() {
  const { userDoc } = useAuth();
  const { alerts, loading } = useAlertHistory(userDoc?.deviceId);
  const [filterDate, setFilterDate] = useState<string>("");
  const [openAlert, setOpenAlert] = useState<AlertDoc | null>(null);

  const filtered = useMemo(() => {
    if (!filterDate) return alerts;
    const target = parseISO(filterDate);
    return alerts.filter((a) => {
      const dt = a.timestamp?.toDate?.();
      return dt && isSameDay(dt, target);
    });
  }, [alerts, filterDate]);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="Historial de alertas" showHistory={false} />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400">Filtrar por fecha:</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          {filterDate && (
            <button
              onClick={() => setFilterDate("")}
              className="text-sm text-slate-400 hover:text-white"
            >
              Limpiar
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-slate-400 text-center py-10">Cargando alertas...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400">
              {alerts.length === 0
                ? "Todavía no hay alertas registradas."
                : "No hay alertas en esa fecha."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((a) => (
              <AlertRow key={a.id} alert={a} onOpen={() => setOpenAlert(a)} />
            ))}
          </ul>
        )}
      </main>

      {openAlert && <AlertDetailModal alert={openAlert} onClose={() => setOpenAlert(null)} />}
    </div>
  );
}

function AlertRow({ alert, onOpen }: { alert: AlertDoc; onOpen: () => void }) {
  const dt = alert.timestamp?.toDate?.();
  const when = dt ? format(dt, "PPpp", { locale: es }) : "—";

  return (
    <li className="bg-bg-card border border-white/5 rounded-2xl p-4 flex items-center gap-4">
      {alert.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={alert.photoUrl}
          alt="Miniatura de la alerta"
          className="w-16 h-16 rounded-lg object-cover border border-white/10 flex-shrink-0"
        />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0">
          <span className="text-slate-500 text-xs">sin foto</span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{when}</p>
        <p className="text-xs text-slate-500 truncate">
          {alert.location.lat.toFixed(5)}, {alert.location.lng.toFixed(5)}
        </p>
      </div>

      <button
        onClick={onOpen}
        className="text-sm bg-accent hover:bg-accent-bright text-white rounded-lg px-3 py-2"
      >
        Ver
      </button>
    </li>
  );
}

function AlertDetailModal({ alert, onClose }: { alert: AlertDoc; onClose: () => void }) {
  const [downloading, setDownloading] = useState<"photo" | "audio" | null>(null);
  const dt = alert.timestamp?.toDate?.() ?? new Date();
  const when = format(dt, "PPpp", { locale: es });

  const onDownload = async (which: "photo" | "audio") => {
    setDownloading(which);
    try {
      const url = which === "photo" ? alert.photoUrl : alert.audioUrl;
      const ext = which === "photo" ? "jpg" : "mp3";
      const ts = format(dt, "yyyyMMdd-HHmmss");
      await downloadFile(url, `safewalk-${which}-${ts}.${ext}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-bg-card border border-white/10 rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Alerta</h2>
            <p className="text-sm text-slate-400">{when}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-white">
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="p-4 space-y-4">
          <div className="rounded-xl overflow-hidden h-56">
            <Map center={alert.location} alertLocation={alert.location} zoom={17} />
          </div>

          {alert.photoUrl && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-slate-400">Foto</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={alert.photoUrl}
                alt="Foto del momento"
                className="w-full max-h-80 object-cover rounded-lg border border-white/10"
              />
              <button
                onClick={() => onDownload("photo")}
                disabled={downloading === "photo"}
                className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg py-2 px-3"
              >
                {downloading === "photo" ? "Descargando..." : "Descargar foto"}
              </button>
            </div>
          )}

          {alert.audioUrl && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-slate-400">Audio</p>
              <audio src={alert.audioUrl} controls className="w-full" />
              <button
                onClick={() => onDownload("audio")}
                disabled={downloading === "audio"}
                className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg py-2 px-3"
              >
                {downloading === "audio" ? "Descargando..." : "Descargar audio"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
