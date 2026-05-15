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
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "ping-slow": "ping 2s cubic-bezier(0, 0, 0.2, 1) infinite"
      }
    }
  },
  plugins: []
};

export default config;
