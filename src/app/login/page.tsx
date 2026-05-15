"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
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
        <div className="text-center mb-10">
          <Logo />
          <h1 className="text-3xl font-bold mt-4">SafeWalk</h1>
          <p className="text-slate-400 mt-2">Bastón inteligente conectado</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 bg-bg-card rounded-2xl p-6 border border-white/5">
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            required
          />
          <Field
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            required
          />

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
            {loading ? "Ingresando..." : "Ingresar"}
          </button>

          <p className="text-center text-sm text-slate-400">
            ¿No tenés cuenta?{" "}
            <Link href="/register" className="text-accent-glow hover:underline">
              Registrate
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  required,
  autoComplete
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-slate-300 mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full bg-bg-elevated border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:border-accent"
      />
    </label>
  );
}

function Logo() {
  return (
    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-accent/15 border border-accent/30">
      <svg viewBox="0 0 24 24" className="w-10 h-10 text-accent" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" d="M9 3v18M9 3c0-1 1-1 2 0l1 1M9 21l-3-2" />
        <circle cx="9" cy="6" r="1.5" fill="currentColor" />
      </svg>
    </div>
  );
}

function translateAuthError(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email o contraseña incorrectos";
    case "auth/invalid-email":
      return "Email inválido";
    case "auth/too-many-requests":
      return "Demasiados intentos. Probá más tarde.";
    case "auth/network-request-failed":
      return "Sin conexión a internet";
    default:
      return "No pudimos iniciar sesión. Intentalo de nuevo.";
  }
}
