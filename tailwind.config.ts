import type { Config } from "tailwindcss";

/**
 * Tailwind is kept only for its reset layer. The design system lives in
 * src/app/globals.css (tokens + component classes) and src/ui (React parts).
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
