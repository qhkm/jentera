import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Only hydrate the exact public route generated at build time. Private pages
// have an empty root and continue through the normal authenticated flow.
if (el.dataset.prerendered === (location.pathname.replace(/\/+$/, '') || '/') && el.hasChildNodes()) {
  hydrateRoot(el, app);
} else createRoot(el).render(app);
