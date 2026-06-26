/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan all app/component files for class usage.
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  // Preflight is disabled: the project already ships a hand-written CSS design
  // system in globals.css. Leaving Tailwind's base reset on would clobber it.
  corePlugins: {
    preflight: false
  },
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
  },
  plugins: []
};
