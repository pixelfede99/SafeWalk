import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0d14",
          elevated: "#121724",
          card: "#1a1f30"
        },
        accent: {
          DEFAULT: "#2563eb",
          bright: "#3b82f6",
          glow: "#60a5fa"
        },
        danger: {
          DEFAULT: "#ef4444",
          dark: "#991b1b"
        },
        success: "#10b981",
        warning: "#f59e0b"
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"]
      },
      keyframes: {
        // Banner de emergencia: baja desde arriba con un leve scale. Aparece pocas
        // veces (eventos raros) → se permite "delight" sin restar urgencia.
        "banner-in": {
          from: { opacity: "0", transform: "translateY(-12px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        // Popover origen-consciente: escala desde su trigger (esquina superior derecha).
        "popover-in": {
          from: { opacity: "0", transform: "scale(0.95) translateY(-4px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" }
        },
        // Fallback de movimiento reducido y entradas suaves de tarjetas.
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" }
        },
        "fade-rise": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "ping-slow": "ping 2s cubic-bezier(0, 0, 0.2, 1) infinite",
        // ease-out fuerte (cubic-bezier(0.23,1,0.32,1)) → arranca rápido, se siente responsivo.
        "banner-in": "banner-in 280ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "popover-in": "popover-in 160ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "fade-in": "fade-in 200ms ease both",
        "fade-rise": "fade-rise 300ms cubic-bezier(0.23, 1, 0.32, 1) both"
      }
    }
  },
  plugins: []
};

export default config;
