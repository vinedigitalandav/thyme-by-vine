import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        apple: {
          blue: "#0071e3",
          "link-blue": "#0066cc",
          "bright-blue": "#2997ff",
          black: "#000000",
          "near-black": "#1d1d1f",
          gray: "#f5f5f7",
          "dark-surface": "#272729",
          "dark-surface-2": "#262628",
          "dark-surface-3": "#28282a",
          "dark-surface-4": "#2a2a2d",
        },
        btn: {
          active: "#ededf2",
          light: "#fafafc",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      letterSpacing: {
        "apple-display": "-0.28px",
        "apple-body": "-0.374px",
        "apple-link": "-0.224px",
        "apple-micro": "-0.12px",
      },
      lineHeight: {
        "apple-display": "1.07",
        "apple-heading": "1.10",
        "apple-tile": "1.14",
        "apple-body": "1.47",
      },
      borderRadius: {
        pill: "980px",
        card: "12px",
        btn: "8px",
      },
      boxShadow: {
        card: "rgba(0, 0, 0, 0.22) 3px 5px 30px 0px",
      },
      backdropBlur: {
        nav: "20px",
      },
    },
  },
  plugins: [],
} satisfies Config;
