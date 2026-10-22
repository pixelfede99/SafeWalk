"use client";

import { useEffect, useRef, useState } from "react";
import type { AlertDoc } from "@/types";
import { listenAlertHistory, listenLatestAlert } from "@/lib/firestore";
import { usePageVisibility } from "./usePageVisibility";

export function useLatestAlert(deviceId: string | null | undefined) {
  const visible = usePageVisibility();
  const [alert, setAlert] = useState<AlertDoc | null>(null);
  const lastIdRef = useRef<string | null>(null);
  // Si ya llegó la primera foto de la colección para este bastón. Separado de
  // lastIdRef porque "no había ninguna alerta" (null) también es un estado
  // conocido: antes, la PRIMERA alerta de un bastón nunca mostraba el banner,
  // porque solo contaba como nueva si ya había otra antes.
  const loadedRef = useRef(false);
  const deviceRef = useRef(deviceId);
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    if (deviceRef.current !== deviceId) {
      // Cambió el círculo activo: lo que había del otro bastón no cuenta.
      deviceRef.current = deviceId;
      loadedRef.current = false;
      lastIdRef.current = null;
      setHasNew(false);
    }
    if (!deviceId || !visible) return;
    return listenLatestAlert(deviceId, (a) => {
      const id = a?.id ?? null;
      if (!loadedRef.current) {
        // Primera lectura: es lo que ya estaba, no una alerta nueva.
        loadedRef.current = true;
        lastIdRef.current = id;
      } else if (id && id !== lastIdRef.current) {
        // Incluye las que llegaron con la pestaña oculta (los refs sobreviven a
        // la re-suscripción por visibilidad).
        lastIdRef.current = id;
        setHasNew(true);
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
