"use client";

import dynamic from "next/dynamic";
import type { AlertDoc } from "@/types";
import { hasRealLocation } from "@/lib/location";

const Map = dynamic(() => import("./Map"), { ssr: false });

/**
 * Mapa de una alerta, o un cartel si la alerta no tiene ubicación real.
 * Sin esto, una alerta sin GPS (0,0) mostraba un mapa del océano Atlántico, o
 * con firmware viejo, el Obelisco como si fuera la posición de la persona.
 */
export function AlertLocationMap({ alert, heightClass }: { alert: AlertDoc; heightClass: string }) {
  if (!hasRealLocation(alert.location)) {
    return (
      <div
        className={`${heightClass} rounded-xl border border-dashed border-white/10 bg-bg-elevated flex flex-col items-center justify-center text-center px-6`}
      >
        <p className="text-sm font-medium text-red-300">Sin ubicación</p>
        <p className="text-xs text-slate-400 mt-1">No hay una posición para mostrar en el mapa.</p>
      </div>
    );
  }
  return (
    <div className={`${heightClass} rounded-xl overflow-hidden`}>
      <Map center={alert.location} alertLocation={alert.location} zoom={17} showMarker={false} />
    </div>
  );
}
