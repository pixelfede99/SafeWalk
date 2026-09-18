"use client";

import { useEffect, useState } from "react";

/**
 * Reloj que avanza solo, para estados que dependen del paso del tiempo.
 *
 * Hace falta por un motivo puntual: un bastón que se desconecta deja de mandar
 * heartbeats, así que NO llega ningún snapshot de Firestore que dispare un
 * re-render. Sin este tick, la pantalla se quedaría mostrando "CONECTADO" para
 * siempre — justamente porque está desconectado.
 */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
