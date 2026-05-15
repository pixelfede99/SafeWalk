"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";

export function TopBar({ title, showHistory = true }: { title: string; showHistory?: boolean }) {
  const router = useRouter();

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-white/5">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          {showHistory && (
            <Link
              href="/alerts"
              className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
            >
              Historial
            </Link>
          )}
          <button
            onClick={onLogout}
            className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
