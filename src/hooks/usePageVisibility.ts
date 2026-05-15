"use client";

import { useEffect, useState } from "react";

/**
 * Hook que devuelve si la pesta&#241;a est&#225; visible.
 * Lo usamos para pausar listeners de Firestore cuando el usuario
 * cambia de pesta&#241;a o minimiza el navegador.
 */
export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : !document.hidden
  );

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visible;
}
