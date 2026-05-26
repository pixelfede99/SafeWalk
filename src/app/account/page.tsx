"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TopBar } from "@/components/TopBar";
import { signOut } from "@/lib/auth";
import {
  getDevice,
  setUserRole,
  leaveDevice,
  generateInviteCode
} from "@/lib/firestore";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DeviceDoc, UserRole } from "@/types";

export default function AccountPage() {
  return (
    <ProtectedRoute requiresDevice={false}>
      <AccountContent />
    </ProtectedRoute>
  );
}

function AccountContent() {
  const router = useRouter();
  const { user, userDoc } = useAuth();
  const [device, setDevice] = useState<DeviceDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!userDoc?.deviceId) {
      setDevice(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getDevice(userDoc.deviceId).then((d) => {
      setDevice(d);
      setLoading(false);
    });
  }, [userDoc?.deviceId]);

  const onChangeRole = async (newRole: UserRole) => {
    if (!user || !userDoc) return;
    setBusy("role");
    try {
      await setUserRole(user.uid, newRole);
      router.replace(newRole === "blind_user" ? "/blind" : "/dashboard");
    } finally {
      setBusy(null);
    }
  };

  const onUnpair = async () => {
    if (!user || !device || !userDoc) return;
    const ok = confirm(
      `¿Seguro que querés desvincular el bastón "${device.name}"?\n\nNo vas a poder ver su ubicación ni recibir alertas.`
    );
    if (!ok) return;
    setBusy("unpair");
    try {
      const isOwner = device.ownerUid === user.uid;
      await leaveDevice(user.uid, device.deviceId, isOwner);
      router.replace("/pair");
    } finally {
      setBusy(null);
    }
  };

  const onRegenerateCode = async () => {
    if (!device) return;
    setBusy("code");
    try {
      const newCode = generateInviteCode();
      await updateDoc(doc(db, "devices", device.deviceId), { inviteCode: newCode });
      setDevice({ ...device, inviteCode: newCode });
    } finally {
      setBusy(null);
    }
  };

  const onCopyCode = async () => {
    if (!device?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(device.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* navegadores sin clipboard API */
    }
  };

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  const isOwner = device && user && device.ownerUid === user.uid;
  const memberCount = device ? 1 + (device.caregiverUids?.filter((u) => u !== device.ownerUid).length ?? 0) : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="Mi cuenta" showHistory={false} />

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 space-y-4">
        {/* Datos del usuario */}
        <Card title="Perfil">
          <Row label="Nombre" value={userDoc?.name || "—"} />
          <Row label="Email" value={user?.email ?? "—"} />
          <Row
            label="Tipo de usuario"
            value={userDoc?.role === "blind_user" ? "Usuario del bastón" : "Familiar / Cuidador"}
          />
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => onChangeRole(userDoc?.role === "blind_user" ? "caregiver" : "blind_user")}
              disabled={busy === "role"}
              className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            >
              {busy === "role" ? "Cambiando..." : "Cambiar tipo de usuario"}
            </button>
          </div>
        </Card>

        {/* Círculo / Bastón */}
        <Card title="Mi círculo">
          {loading ? (
            <p className="text-slate-400 text-sm">Cargando...</p>
          ) : !device ? (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">No estás vinculado a ningún bastón todavía.</p>
              <button
                onClick={() => router.push("/pair")}
                className="bg-accent hover:bg-accent-bright text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                Vincular un bastón
              </button>
            </div>
          ) : (
            <>
              <Row label="Bastón" value={device.name} />
              <Row label="Tu rol" value={isOwner ? "Dueño" : "Cuidador"} />
              <Row label="Miembros" value={`${memberCount} persona${memberCount === 1 ? "" : "s"}`} />

              <div className="pt-3 border-t border-white/5">
                <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Código de invitación</p>
                <p className="text-xs text-slate-500 mb-3">
                  Compartilo con familiares para que se unan al círculo y vean este bastón.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 font-mono text-xl tracking-widest text-center">
                    {device.inviteCode || "------"}
                  </code>
                  <button
                    onClick={onCopyCode}
                    className="bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-3"
                    aria-label="Copiar código"
                  >
                    {copied ? "✓" : "📋"}
                  </button>
                </div>
                {isOwner && (
                  <button
                    onClick={onRegenerateCode}
                    disabled={busy === "code"}
                    className="text-xs text-slate-400 hover:text-white mt-2"
                  >
                    {busy === "code" ? "Generando..." : "Regenerar código"}
                  </button>
                )}
              </div>

              <div className="pt-3 border-t border-white/5">
                <button
                  onClick={onUnpair}
                  disabled={busy === "unpair"}
                  className="text-sm bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger rounded-lg px-3 py-2"
                >
                  {busy === "unpair" ? "Desvinculando..." : isOwner ? "Eliminar bastón" : "Salir del círculo"}
                </button>
              </div>
            </>
          )}
        </Card>

        {/* Salir */}
        <Card title="Sesión">
          <button
            onClick={onLogout}
            className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-4 py-2"
          >
            Cerrar sesión
          </button>
        </Card>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg-card border border-white/5 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm uppercase tracking-wider text-slate-400 font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
