import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'hero-reel': {
          '0%, 14%': { transform: 'translateX(0%)' },
          '18%, 32%': { transform: 'translateX(-16.666%)' },
          '36%, 50%': { transform: 'translateX(-33.333%)' },
          '54%, 68%': { transform: 'translateX(-50%)' },
          '72%, 86%': { transform: 'translateX(-66.666%)' },
          '90%, 100%': { transform: 'translateX(-83.333%)' },
        },
      },
      animation: {
        'hero-reel': 'hero-reel 48s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;