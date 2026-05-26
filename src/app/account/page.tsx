"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TopBar } from "@/components/TopBar";
import { signOut } from "@/lib/auth";
import {
  getDevices,
  setUserRole,
  leaveDevice,
  switchActiveDevice,
  joinDeviceByCode,
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
  const [devices, setDevices] = useState<DeviceDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showJoinForm, setShowJoinForm] = useState(false);

  const deviceIds = userDoc?.deviceIds ?? (userDoc?.deviceId ? [userDoc.deviceId] : []);

  useEffect(() => {
    if (deviceIds.length === 0) {
      setDevices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getDevices(deviceIds).then((d) => {
      setDevices(d);
      setLoading(false);
    });
  }, [deviceIds.join(",")]);

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

  const onSwitchActive = async (deviceId: string) => {
    if (!user || deviceId === userDoc?.deviceId) return;
    setBusy(`switch-${deviceId}`);
    try {
      await switchActiveDevice(user.uid, deviceId);
    } finally {
      setBusy(null);
    }
  };

  const onUnpair = async (device: DeviceDoc) => {
    if (!user) return;
    const isOwner = device.ownerUid === user.uid;
    const ok = confirm(
      `¿${isOwner ? "Eliminar" : "Salir de"} "${device.name}"?\n\nNo vas a poder ver su ubicación ni recibir alertas.`
    );
    if (!ok) return;
    setBusy(`leave-${device.deviceId}`);
    try {
      const remaining = deviceIds.filter((id) => id !== device.deviceId);
      const nextActive = await leaveDevice(user.uid, device.deviceId, isOwner, remaining);
      if (!nextActive) {
        router.replace("/pair");
      }
    } finally {
      setBusy(null);
    }
  };

  const onRegenerateCode = async (device: DeviceDoc) => {
    setBusy(`regen-${device.deviceId}`);
    try {
      const newCode = generateInviteCode();
      await updateDoc(doc(db, "devices", device.deviceId), { inviteCode: newCode });
      setDevices((arr) =>
        arr.map((d) => (d.deviceId === device.deviceId ? { ...d, inviteCode: newCode } : d))
      );
    } finally {
      setBusy(null);
    }
  };

  const onCopyCode = async (device: DeviceDoc) => {
    if (!device.inviteCode) return;
    try {
      await navigator.clipboard.writeText(device.inviteCode);
      setCopiedId(device.deviceId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* sin clipboard API */
    }
  };

  const onJoinSubmit = async () => {
    if (!user || joinCode.length < 6) return;
    setJoinError(null);
    setBusy("join");
    try {
      await joinDeviceByCode(user.uid, joinCode);
      setJoinCode("");
      setShowJoinForm(false);
    } catch (err) {
      setJoinError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="Mi cuenta" showHistory={false} showSwitcher={false} />

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-4 space-y-4">
        {/* Perfil */}
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

        {/* Lista de círculos */}
        <Card title={`Mis círculos${devices.length > 0 ? ` (${devices.length})` : ""}`}>
          {loading ? (
            <p className="text-slate-400 text-sm">Cargando...</p>
          ) : devices.length === 0 ? (
            <p className="text-slate-400 text-sm">Todavía no estás en ningún círculo.</p>
          ) : (
            <div className="space-y-3">
              {devices.map((d) => (
                <CircleCard
                  key={d.deviceId}
                  device={d}
                  isOwner={d.ownerUid === user?.uid}
                  isActive={d.deviceId === userDoc?.deviceId}
                  copied={copiedId === d.deviceId}
                  busy={busy}
                  onSwitch={() => onSwitchActive(d.deviceId)}
                  onCopy={() => onCopyCode(d)}
                  onRegenerate={() => onRegenerateCode(d)}
                  onLeave={() => onUnpair(d)}
                />
              ))}
            </div>
          )}

          {/* Unirme a otro círculo */}
          <div className="pt-3 border-t border-white/5">
            {!showJoinForm ? (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setShowJoinForm(true)}
                  className="text-sm bg-accent hover:bg-accent-bright text-white rounded-lg px-3 py-2"
                >
                  🔗 Unirme a otro círculo
                </button>
                <button
                  onClick={() => router.push("/pair")}
                  className="text-sm bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                >
                  + Vincular un bastón nuevo
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Pegá el código que te compartieron:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ABC234"
                    maxLength={6}
                    className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-center font-mono text-lg tracking-widest focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={onJoinSubmit}
                    disabled={joinCode.length < 6 || busy === "join"}
                    className="bg-accent hover:bg-accent-bright disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4"
                  >
                    {busy === "join" ? "..." : "Unirme"}
                  </button>
                </div>
                {joinError && <p className="text-danger text-xs">{joinError}</p>}
                <button
                  onClick={() => {
                    setShowJoinForm(false);
                    setJoinError(null);
                    setJoinCode("");
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* Sesión */}
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

function CircleCard({
  device,
  isOwner,
  isActive,
  copied,
  busy,
  onSwitch,
  onCopy,
  onRegenerate,
  onLeave
}: {
  device: DeviceDoc;
  isOwner: boolean;
  isActive: boolean;
  copied: boolean;
  busy: string | null;
  onSwitch: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      className={`border rounded-xl p-3 space-y-3 ${
        isActive ? "border-accent/40 bg-accent/5" : "border-white/10 bg-bg-elevated/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{device.name}</p>
          <p className="text-xs text-slate-400">
            {isOwner ? "Dueño" : "Cuidador"} ·{" "}
            {1 + (device.caregiverUids?.filter((u) => u !== device.ownerUid).length ?? 0)} miembro
            {(device.caregiverUids?.length ?? 0) === 0 ? "" : "s"}
          </p>
        </div>
        {isActive ? (
          <span className="text-xs bg-accent/20 text-accent-glow rounded-full px-2 py-1 flex-shrink-0">
            Activo
          </span>
        ) : (
          <button
            onClick={onSwitch}
            disabled={busy === `switch-${device.deviceId}`}
            className="text-xs bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
          >
            {busy === `switch-${device.deviceId}` ? "..." : "Ver"}
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 font-mono text-base tracking-widest text-center">
            {device.inviteCode || "------"}
          </code>
          <button
            onClick={onCopy}
            className="bg-bg-elevated hover:bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
            aria-label="Copiar código"
          >
            {copied ? "✓" : "📋"}
          </button>
        </div>
        {isOwner && (
          <button
            onClick={onRegenerate}
            disabled={busy === `regen-${device.deviceId}`}
            className="text-xs text-slate-400 hover:text-white mt-1"
          >
            {busy === `regen-${device.deviceId}` ? "Generando..." : "Regenerar código"}
          </button>
        )}
      </div>

      <button
        onClick={onLeave}
        disabled={busy === `leave-${device.deviceId}`}
        className="text-xs bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger rounded-lg px-3 py-1.5"
      >
        {busy === `leave-${device.deviceId}`
          ? "..."
          : isOwner
          ? "Eliminar bastón"
          : "Salir del círculo"}
      </button>
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
