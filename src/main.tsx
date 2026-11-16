import { createRoot } from 'react-dom/client';
import { lab } from './lab/lab';
import { conditions } from './sim/conditions';
import { App } from './ui/App';
import './ui/styles.css';

// Handles for automation and for poking at the lab from the console (see CLAUDE.md, "Driving the lab").
(window as unknown as { __lab: Record<string, unknown> }).__lab = { lab, conditions };

const root = document.getElementById('root');
if (!root) {
	throw new Error('#root missing');
}
createRoot(root).render(<App />);
