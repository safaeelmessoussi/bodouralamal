import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Application shell lands with M1+; pages follow the §14.1 sitemap only.
// All UI strings flow through i18n keys (SRS §16.2) — none exist yet.
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<StrictMode>{null}</StrictMode>);
}
