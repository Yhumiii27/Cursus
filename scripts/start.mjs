// npm start : serveur de production (interface compilée par npm run build), sur tout système, Windows compris : la
// forme « NODE_ENV=production node … » n'est comprise que par les shells Unix. Le service systemd et l'image Docker
// lancent directement node server/src/index.ts, NODE_ENV venant de leur environnement (docs/DEPLOIEMENT.md).
process.env.NODE_ENV = 'production';
await import('../server/src/index.ts');
