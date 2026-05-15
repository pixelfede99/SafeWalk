"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/types";

interface Props {
  role?: UserRole;
  requiresDevice?: boolean;
  children: ReactNode;
}

export function ProtectedRoute({ role, requiresDevice = true, children }: Props) {
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
    if (role && userDoc.role !== role) {
      router.replace(userDoc.role === "blind_user" ? "/blind" : "/dashboard");
      return;
    }
    if (requiresDevice && !userDoc.deviceId) {
      router.replace("/pair");
    }
  }, [user, userDoc, loading, router, role, requiresDevice]);

  if (loading || !user || !userDoc?.role || (requiresDevice && !userDoc.deviceId)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
