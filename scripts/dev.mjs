// Lance l'API (node --watch) et le client Vite en parallèle.
import { spawn } from 'node:child_process';

// L'API écoute sur CURSUS_API_PORT (3210 par défaut) ; Vite la sert via son proxy /api.
const env = { ...process.env, CURSUS_API_PORT: process.env.CURSUS_API_PORT || '3210' };
const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev:client'], { stdio: 'inherit', env }),
];
const stop = () => { procs.forEach(p => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach(p => p.on('exit', code => { if (code) stop(); }));
