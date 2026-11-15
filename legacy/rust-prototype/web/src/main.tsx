import { createRoot } from 'react-dom/client';
import { App } from './App';
import { authenticateFromFragment } from './api';
import './styles.css';

// Start once outside React effects. The token leaves the address bar before any request.
const sessionReady = authenticateFromFragment(window.location, window.history);
void sessionReady.catch(() => {}); // React presents the safe failure once mounted.
createRoot(document.getElementById('root')!).render(<App sessionReady={sessionReady} />);
