"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { DeviceDoc } from "@/types";
import { BatteryIcon } from "./BatteryIcon";

export function DevicePanel({ device }: { device: DeviceDoc | null }) {
  if (!device) {
    return (
      <div className="bg-bg-card border border-white/5 rounded-2xl p-4 animate-pulse">
        <div className="h-5 w-32 bg-white/10 rounded mb-3" />
        <div className="h-4 w-48 bg-white/5 rounded" />
      </div>
    );
  }

  const lastSeenDate = device.lastSeen?.toDate?.();
  const lastSeenStr = lastSeenDate
    ? formatDistanceToNow(lastSeenDate, { addSuffix: true, locale: es })
    : "—";

  return (
    <div className="bg-bg-card border border-white/5 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider">Bastón</p>
          <p className="text-lg font-semibold">{device.name}</p>
        </div>
        <StatusPill online={device.isOnline} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="Batería"
          value={
            <div className="flex items-center gap-2">
              <BatteryIcon level={device.batteryLevel} />
              <span>{device.batteryLevel}%</span>
            </div>
          }
        />
        <Metric label="Velocidad" value={`${device.speed.toFixed(1)} m/s`} />
        <Metric label="Última vez" value={device.isOnline ? "ahora" : lastSeenStr} />
      </div>
    </div>
  );
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
        online ? "bg-success/15 text-success" : "bg-slate-700/50 text-slate-400"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${online ? "bg-success animate-pulse" : "bg-slate-500"}`}
      />
      {online ? "En línea" : "Offline"}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
