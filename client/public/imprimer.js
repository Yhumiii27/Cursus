// Lance l'impression d'un document ouvert par client/src/print.ts, une fois la page chargée
// (feuille de style comprise). Fichier servi tel quel : la CSP interdit les scripts en ligne.
const lancer = () => setTimeout(() => window.print(), 150);
if (document.readyState === 'complete') lancer();
else window.addEventListener('load', lancer, { once: true });
