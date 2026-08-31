import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensurePersistentStorage } from './platform/persistence';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

// Ask the platform not to evict the database, before anything can be written
// to it. Deliberately not awaited: this is a best-effort mitigation and must
// never delay or block start-up. `ensurePersistentStorage` never rejects.
void ensurePersistentStorage();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
