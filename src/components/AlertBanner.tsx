"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import dynamic from "next/dynamic";
import type { AlertDoc } from "@/types";
import { downloadFile } from "@/lib/storage";

const Map = dynamic(() => import("./Map"), { ssr: false });

export function AlertBanner({ alert, onDismiss }: { alert: AlertDoc; onDismiss: () => void }) {
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
    } catch (e) {
      console.error("Error descargando", e);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="mx-auto max-w-3xl rounded-2xl border-2 border-danger bg-bg-card shadow-2xl shadow-danger/30 overflow-hidden">
        <header className="bg-danger px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span className="font-bold text-white uppercase tracking-wide">Alerta de emergencia</span>
          </div>
          <button onClick={onDismiss} className="text-white/80 hover:text-white" aria-label="Cerrar alerta">
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-400">{when}</p>

          <div className="rounded-xl overflow-hidden h-48 sm:h-56">
            <Map center={alert.location} alertLocation={alert.location} zoom={17} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {alert.photoUrl && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">Foto</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={alert.photoUrl}
                  alt="Foto del momento de la alerta"
                  className="w-full h-40 object-cover rounded-lg border border-white/10"
                />
                <button
                  onClick={() => onDownload("photo")}
                  disabled={downloading === "photo"}
                  className="w-full text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg py-2 px-3"
                >
                  {downloading === "photo" ? "Descargando..." : "Descargar foto"}
                </button>
              </div>
            )}

            {alert.audioUrl && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">Audio (15s)</p>
                <audio
                  src={alert.audioUrl}
                  controls
                  className="w-full h-10 rounded-lg"
                  style={{ filter: "invert(0.9)" }}
                />
                <button
                  onClick={() => onDownload("audio")}
                  disabled={downloading === "audio"}
                  className="w-full text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg py-2 px-3"
                >
                  {downloading === "audio" ? "Descargando..." : "Descargar audio"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
