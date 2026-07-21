// theme.js
//
// Applies the school's configured primary/secondary colors to every
// page that includes this file, by overriding the CSS custom
// properties defined in styles.css. Change these once in Settings,
// and the whole site's color scheme updates everywhere — no code
// editing required.
//
// Must be included AFTER config.js (needs API_BASE_URL) and AFTER
// the <link rel="stylesheet" href="styles.css"> tag.

async function applyTheme() {
  try {
    const res = await fetch(`${API_BASE_URL}/settings`);
    if (!res.ok) return;
    const config = await res.json();
    if (!config) return;

    const root = document.documentElement;
    if (config.primaryColor) root.style.setProperty('--ink', config.primaryColor);
    if (config.secondaryColor) root.style.setProperty('--ochre', config.secondaryColor);
  } catch (err) {
    // Fall back silently to the default colors already in styles.css
  }
}

applyTheme();
