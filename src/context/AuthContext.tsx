"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getUserDoc, listenUserDoc, createUserDoc } from "@/lib/firestore";
import type { UserDoc } from "@/types";

interface AuthState {
  user: User | null;
  userDoc: UserDoc | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  userDoc: null,
  loading: true
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setUserDoc(null);
        setLoading(false);
        return;
      }
      try {
        let initial = await getUserDoc(u.uid);
        // Si el usuario existe en Firebase Auth pero no tiene doc en Firestore
        // (caso típico: el signup creó el Auth user pero falló al guardar el doc),
        // lo creamos ahora con los datos disponibles.
        if (!initial) {
          console.log("[AuthContext] creando doc del usuario que no existía...");
          await createUserDoc(u.uid, u.email ?? "", u.displayName ?? "Usuario");
          initial = await getUserDoc(u.uid);
        }
        setUserDoc(initial);
      } catch (err) {
        console.error("[AuthContext] no se pudo leer el doc del usuario:", err);
        setUserDoc(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Suscripci&#243;n en vivo al doc del usuario para que rol/deviceId se actualicen al instante
  useEffect(() => {
    if (!user) return;
    const unsub = listenUserDoc(user.uid, (u) => setUserDoc(u));
    return () => unsub();
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, userDoc, loading }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
