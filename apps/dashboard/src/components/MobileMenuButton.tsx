'use client';

// Hamburger shown only on small screens (CSS-gated). Fires the global toggle
// event the Sidebar listens for to open its off-canvas drawer.
export function MobileMenuButton() {
  return (
    <button
      type="button"
      className="mobile-menu-btn"
      aria-label="Open menu"
      onClick={() => window.dispatchEvent(new Event('fleet:toggle-sidebar'))}
    >
      <span />
      <span />
      <span />
    </button>
  );
}
