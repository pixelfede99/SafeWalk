"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signUp(email, password, name);
      router.replace("/role-select");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(translateAuthError(code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-2">Crear cuenta</h1>
        <p className="text-slate-400 text-center mb-8">Sumate a SafeWalk</p>

        <form onSubmit={onSubmit} className="space-y-4 bg-bg-card rounded-2xl p-6 border border-white/5">
          <label className="block">
            <span className="text-sm text-slate-300 mb-1 block">Nombre</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-300 mb-1 block">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-300 mb-1 block">Contraseña (mín. 6)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-accent"
            />
          </label>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 transition-colors text-white font-semibold py-3 rounded-lg"
          >
            {loading ? "Creando..." : "Crear cuenta"}
          </button>

          <p className="text-center text-sm text-slate-400">
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="text-accent-glow hover:underline">
              Iniciar sesión
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

function translateAuthError(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "Ya existe una cuenta con ese email";
    case "auth/weak-password":
      return "La contraseña es demasiado corta";
    case "auth/invalid-email":
      return "Email inválido";
    default:
      return "No pudimos crear la cuenta. Intentalo de nuevo.";
  }
}
