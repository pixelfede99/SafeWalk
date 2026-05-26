"use client";

import { useEffect, useState } from "react";
import { getDevices, switchActiveDevice } from "@/lib/firestore";
import type { DeviceDoc } from "@/types";

interface Props {
  uid: string;
  deviceIds: string[];
  activeDeviceId: string | null;
}

/** Selector flotante para cambiar entre círculos cuando el usuario pertenece a varios. */
export function CircleSwitcher({ uid, deviceIds, activeDeviceId }: Props) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceDoc[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (deviceIds.length === 0) return;
    getDevices(deviceIds).then(setDevices);
  }, [deviceIds]);

  // Si solo tiene un círculo, no hace falta el switcher
  if (deviceIds.length <= 1) return null;

  const active = devices.find((d) => d.deviceId === activeDeviceId);

  const onSwitch = async (deviceId: string) => {
    if (deviceId === activeDeviceId) {
      setOpen(false);
      return;
    }
    setSwitching(deviceId);
    try {
      await switchActiveDevice(uid, deviceId);
      setOpen(false);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
      >
        <span className="w-2 h-2 rounded-full bg-accent" />
        <span className="font-medium">{active?.name ?? "Círculo"}</span>
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-label="Cerrar selector"
          />
          <div className="absolute right-0 top-full mt-2 w-64 bg-bg-card border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
            <p className="px-3 py-2 text-xs uppercase tracking-wider text-slate-400 border-b border-white/5">
              Cambiar de círculo
            </p>
            <ul>
              {devices.map((d) => (
                <li key={d.deviceId}>
                  <button
                    onClick={() => onSwitch(d.deviceId)}
                    disabled={switching === d.deviceId}
                    className="w-full text-left px-3 py-3 hover:bg-white/5 flex items-center gap-2"
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        d.isOnline ? "bg-success" : "bg-slate-500"
                      }`}
                    />
                    <span className="flex-1 truncate">{d.name}</span>
                    {d.deviceId === activeDeviceId && (
                      <span className="text-xs text-accent-glow">activo</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
