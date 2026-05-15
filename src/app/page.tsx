"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const router = useRouter();
  const { user, userDoc, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }
    if (!userDoc?.role) {
      router.replace("/role-select");
      return;
    }
    if (!userDoc.deviceId) {
      router.replace("/pair");
      return;
    }
    if (userDoc.role === "blind_user") {
      router.replace("/blind");
    } else {
      router.replace("/dashboard");
    }
  }, [user, userDoc, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full border-4 border-accent border-t-transparent animate-spin" />
        <p className="text-slate-400">Cargando SafeWalk...</p>
      </div>
    </div>
  );
}
