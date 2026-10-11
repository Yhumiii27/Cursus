// Lance l'API (node --watch) et le client Vite en parallèle.
import { spawn } from 'node:child_process';

// L'API écoute sur CURSUS_API_PORT (3210 par défaut) ; Vite la sert via son proxy /api.
// Le mode démonstration est actif par défaut en développement (CURSUS_DEMO=0 pour le couper).
const env = { ...process.env, CURSUS_API_PORT: process.env.CURSUS_API_PORT || '3210', CURSUS_DEMO: process.env.CURSUS_DEMO ?? '1' };
const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev:client'], { stdio: 'inherit', env }),
];
const stop = () => { procs.forEach(p => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach(p => p.on('exit', code => { if (code) stop(); }));
