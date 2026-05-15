"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getUserDoc, listenUserDoc } from "@/lib/firestore";
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
      const initial = await getUserDoc(u.uid);
      setUserDoc(initial);
      setLoading(false);
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
