// Builds dist/output.css, the site's only Tailwind stylesheet. After adding
// or changing Tailwind classes in any page or dist/*.js, rebuild it with:
//
//   npx tailwindcss@3.4.19 -i src/input.css -o dist/output.css --minify
//
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./dist/*.{html,js}"],
  theme: {
    extend: {
      fontFamily: {
        nothingyoucoulddo: ["Nothing You Could Do", "cursive"],
        signika: ["Signika", "sans-serif"],
      },
    },
  },
  plugins: [],
};
