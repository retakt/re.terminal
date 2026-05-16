/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ['class'],
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        input: "var(--bg-base)",
        ring: "var(--accent-orange)",
        background: "var(--bg-base)",
        foreground: "var(--fg-base)",
        primary: {
          DEFAULT: "var(--accent-orange)",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "var(--bg-highlight)",
          foreground: "var(--fg-base)",
        },
        muted: {
          DEFAULT: "var(--bg-highlight)",
          foreground: "var(--fg-muted)",
        },
        accent: {
          DEFAULT: "var(--accent-orange)",
          foreground: "#ffffff",
        },
        destructive: {
          DEFAULT: "var(--accent-red)",
          foreground: "#ffffff",
        },
      },
      borderRadius: {
        lg: "12px",
        md: "8px",
        sm: "6px",
      },
      fontFamily: {
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-in": "slideIn 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideIn: {
          "0%": { transform: "translateX(10px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
}
