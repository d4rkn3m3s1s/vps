/** @type {import('tailwindcss').Config} */
// Tailwind v4 is CSS-first. HeroUI v3 ships prebuilt CSS (@heroui/styles, imported
// in globals.css) — it does NOT use a Tailwind plugin. This file (loaded via
// `@config`) only carries theme extensions (fonts, keyframes). `corePlugins` and
// `content` are no longer honored in v4 — preflight is deferred at the CSS-import
// layer instead (see globals.css header).
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        podium: ['"FSP DEMO - PODIUM Sharp 4.11"', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif']
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.9)' },
          to: { opacity: '1', transform: 'scale(1)' }
        }
      }
    }
  }
};
