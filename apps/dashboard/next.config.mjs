/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // The dashboard source lives on the Windows filesystem (/mnt/c) but the dev
  // server runs inside WSL. WSL cannot receive inotify events for files on the
  // 9p Windows mount, so native file watching NEVER fires → edits don't hot-
  // reload until you restart. Force POLLING so changes are picked up on /mnt/c.
  // (Only the webpack dev path reads this; the Turbopack path is covered by the
  // WATCHPACK_POLLING / CHOKIDAR_USEPOLLING env vars set in the dev launcher.)
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 800,            // re-scan every 800ms
        aggregateTimeout: 250 // debounce rebuilds
      };
    }
    return config;
  }
};

export default nextConfig;
