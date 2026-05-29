"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { CircleSwitcher } from "./CircleSwitcher";

export function TopBar({
  title,
  showHistory = true,
  showSwitcher = true
}: {
  title: string;
  showHistory?: boolean;
  showSwitcher?: boolean;
}) {
  const { user, userDoc } = useAuth();
  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-white/5">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold truncate">{title}</h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          {showSwitcher && user && userDoc?.deviceIds && (
            <CircleSwitcher
              uid={user.uid}
              deviceIds={userDoc.deviceIds}
              activeDeviceId={userDoc.deviceId}
            />
          )}
          {showHistory && (
            <Link
              href="/alerts"
              className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 transition-transform duration-150 motion-safe:active:scale-[0.97]"
            >
              Historial
            </Link>
          )}
          <Link
            href="/account"
            aria-label="Cuenta"
            className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-transform duration-150 motion-safe:active:scale-[0.97]"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Cuenta
          </Link>
        </div>
      </div>
    </header>
  );
}
