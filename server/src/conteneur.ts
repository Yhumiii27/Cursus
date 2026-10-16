// Image Docker (Dockerfile, CURSUS_CONTENEUR=1) : le conteneur démarre sous root le temps de rendre le dossier des données
// (volume /data) au compte `cursus`, puis abandonne définitivement ces droits avant d'ouvrir la base. Importé en premier
// par le serveur et par les commandes (npm run comptes, backup, restore), pour qu'un `docker exec` sous root n'écrive
// jamais dans la base un fichier que le service ne pourrait plus ouvrir.
// Pourquoi : les images d'avant le lot 4 tournaient sous root ; leur volume /data (base, WAL, sauvegardes) appartient
// donc à root, et le compte `cursus` des images suivantes ne pouvait ni l'ouvrir ni en restreindre les droits : le
// serveur s'arrêtait au démarrage (base inaccessible) et le site restait injoignable.
import { chownSync, existsSync, lchownSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Compte du service dans /etc/passwd : identifiants numériques, ou null s'il n'existe pas. */
export function compteService(passwd: string, nom = 'cursus'): { uid: number; gid: number } | null {
  const champs = passwd.split('\n').find(l => l.startsWith(`${nom}:`))?.split(':');
  if (!champs || champs.length < 4) return null;
  const uid = Number(champs[2]), gid = Number(champs[3]);
  return Number.isInteger(uid) && Number.isInteger(gid) ? { uid, gid } : null;
}

/**
 * Rend au compte `uid:gid` le dossier `dir` et tout son contenu (liens symboliques compris, sans les suivre) ; renvoie le
 * nombre d'entrées changées. Seules celles qui n'appartiennent pas déjà au compte sont touchées.
 */
export function reprendreDossier(dir: string, uid: number, gid: number, fs: { chown: (p: string, u: number, g: number) => void; lchown: (p: string, u: number, g: number) => void } = { chown: chownSync, lchown: lchownSync }): number {
  let n = 0;
  const visiter = (p: string) => {
    const st = lstatSync(p);
    if (st.uid !== uid || st.gid !== gid) {
      (st.isSymbolicLink() ? fs.lchown : fs.chown)(p, uid, gid);
      n++;
    }
    if (st.isDirectory()) for (const e of readdirSync(p)) visiter(join(p, e));
  };
  visiter(dir);
  return n;
}

if (process.env.CURSUS_CONTENEUR === '1' && process.getuid?.() === 0) {
  const compte = compteService(readFileSync('/etc/passwd', 'utf8'));
  if (!compte) {
    console.error('Démarrage impossible : compte « cursus » absent de l’image (Dockerfile).');
    process.exit(1);
  }
  const dossier = dirname(resolve(process.env.CURSUS_DB || '/data/cursus.db'));
  if (!existsSync(dossier)) mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const n = reprendreDossier(dossier, compte.uid, compte.gid);
  if (n) console.log(`Données rendues au compte cursus : ${n} élément${n > 1 ? 's' : ''} de ${dossier} (volume créé sous root par une image antérieure).`);
  process.setgroups!([compte.gid]);
  process.setgid!(compte.gid);
  process.setuid!(compte.uid);
}
