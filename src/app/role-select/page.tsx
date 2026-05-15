"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { setUserRole } from "@/lib/firestore";
import type { UserRole } from "@/types";

export default function RoleSelectPage() {
  const router = useRouter();
  const { user, userDoc, loading } = useAuth();
  const [saving, setSaving] = useState<UserRole | null>(null);

  if (!loading && !user) {
    router.replace("/login");
    return null;
  }

  const onPick = async (role: UserRole) => {
    if (!user) return;
    setSaving(role);
    try {
      await setUserRole(user.uid, role);
      // Si ya tiene dispositivo, va al home; sino, al pairing
      if (userDoc?.deviceId) {
        router.replace(role === "blind_user" ? "/blind" : "/dashboard");
      } else {
        router.replace("/pair");
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-3">¿Cómo vas a usar SafeWalk?</h1>
        <p className="text-slate-400 text-center mb-10">Elegí el rol que mejor te describe.</p>

        <div className="grid md:grid-cols-2 gap-4">
          <RoleCard
            title="Soy el usuario del bastón"
            description="Persona con discapacidad visual. Vas a ver una interfaz simplificada con un botón SOS grande."
            icon={
              <svg viewBox="0 0 24 24" className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M9 3v18M9 3l3 1M6 19l3 2" />
                <circle cx="9" cy="5" r="2" fill="currentColor" />
              </svg>
            }
            loading={saving === "blind_user"}
            onClick={() => onPick("blind_user")}
          />
          <RoleCard
            title="Soy familiar / cuidador"
            description="Vas a poder ver el mapa en tiempo real, alertas y el historial del usuario."
            icon={
              <svg viewBox="0 0 24 24" className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            }
            loading={saving === "caregiver"}
            onClick={() => onPick("caregiver")}
          />
        </div>
      </div>
    </main>
  );
}

function RoleCard({
  title,
  description,
  icon,
  loading,
  onClick
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="text-left bg-bg-card hover:bg-bg-elevated border border-white/5 hover:border-accent/40 rounded-2xl p-6 transition-all disabled:opacity-50"
    >
      <div className="text-accent-glow mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
      {loading && <p className="text-accent text-sm mt-3">Guardando...</p>}
    </button>
  );
}
