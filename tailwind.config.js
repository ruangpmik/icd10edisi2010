/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#071a33", 900: "#0a2a4a", 800: "#0e3560", 700: "#14467e" },
        pmik: { teal: "#0e9f6e", orange: "#f97316" },
      },
    },
  },
  plugins: [],
};
