"use client";

import { useEffect, useState } from "react";
import type { DeviceDoc, LocationPoint } from "@/types";
import { listenDevice, listenTodayHistory } from "@/lib/firestore";
import { usePageVisibility } from "./usePageVisibility";

/**
 * Suscribe en vivo al doc del dispositivo y al recorrido del d&#237;a, pero
 * pausa los listeners cuando la pesta&#241;a deja de ser visible (Page Visibility API)
 * para ahorrar recursos y costos de Firestore.
 */
export function useDevice(deviceId: string | null | undefined) {
  const visible = usePageVisibility();
  const [device, setDevice] = useState<DeviceDoc | null>(null);
  const [trail, setTrail] = useState<LocationPoint[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    if (!visible) {
      setPaused(true);
      return;
    }
    setPaused(false);

    const unsubDevice = listenDevice(deviceId, setDevice);
    const unsubTrail = listenTodayHistory(deviceId, setTrail);

    return () => {
      unsubDevice();
      unsubTrail();
    };
  }, [deviceId, visible]);

  return { device, trail, paused };
}
