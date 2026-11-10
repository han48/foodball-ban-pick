/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#17633b",
        "pitch-light": "#eaf5e9",
        ink: "#183324",
      },
      boxShadow: {
        soft: "0 12px 32px rgba(34, 76, 48, 0.08)",
      },
    },
  },
  plugins: [],
};
