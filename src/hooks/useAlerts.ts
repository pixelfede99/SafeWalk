"use client";

import { useEffect, useRef, useState } from "react";
import type { AlertDoc } from "@/types";
import { listenAlertHistory, listenLatestAlert } from "@/lib/firestore";
import { usePageVisibility } from "./usePageVisibility";

export function useLatestAlert(deviceId: string | null | undefined) {
  const visible = usePageVisibility();
  const [alert, setAlert] = useState<AlertDoc | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    if (!deviceId || !visible) return;
    return listenLatestAlert(deviceId, (a) => {
      if (a && a.id !== lastIdRef.current) {
        // Si ya ten&#237;amos uno previo y ahora viene otro distinto, es una alerta nueva
        if (lastIdRef.current !== null) {
          setHasNew(true);
        }
        lastIdRef.current = a.id;
      }
      setAlert(a);
    });
  }, [deviceId, visible]);

  const dismissNew = () => setHasNew(false);

  return { alert, hasNew, dismissNew };
}

export function useAlertHistory(deviceId: string | null | undefined) {
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!deviceId) return;
    setLoading(true);
    return listenAlertHistory(deviceId, (list) => {
      setAlerts(list);
      setLoading(false);
    });
  }, [deviceId]);

  return { alerts, loading };
}
