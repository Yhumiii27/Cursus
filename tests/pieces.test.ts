// Pièces justificatives (t133) : règles partagées (types reconnus sur le contenu, nom gardé, droits), envoi et
// consultation par HTTP (désactivées par défaut, contrôle du contenu, jeton propre au compte, droits par profil, empreinte),
// rattachement par les actions, retrait et nettoyage, journal sans nom de fichier, export des données personnelles,
// contrôle d'intégrité, sauvegarde et restauration des fichiers, migration des index, adaptateur GED refusé.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CURSUS_TODAY = '2026-10-10';
process.env.CURSUS_DEMO = '1';
delete process.env.CURSUS_PIECES_DIR;
delete process.env.CURSUS_BACKUP_DIR;

const { SqliteDb: Db } = await import('../server/src/db.ts');
const { seedDemo } = await import('../server/src/seed.ts');
const { migrate } = await import('../server/src/migrate.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { createApp } = await import('../server/src/app.ts');
const { currentUser, loadFull, buildSnapshot } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { donneesSalarie } = await import('../server/src/donnees.ts');
const { restaurer, sauvegarder } = await import('../server/src/sauvegarde.ts');
const { fichiersDesignes } = await import('../server/src/pieces-sauvegarde.ts');
const pieces = await import('../server/src/pieces.ts');
const { DepotGed, estFichierGed, GED_NON_RACCORDEE } = await import('../server/src/integrations/ged.ts');
const { INDEX_PIECES } = await import('../server/src/migrations/lot6-pieces.ts');
const { indexExiste } = await import('../server/src/migrations/outils.ts');
const regles = await import('../shared/rules/pieces.ts');
const { appliquerReglages, ReglageInvalide } = await import('../shared/reglages.ts');
const { DEFAULT_SETTINGS } = await import('../server/src/dataset.ts');
const { refusCsrf } = await import('../server/src/securite.ts');
const { reglerJournaux } = await import('../server/src/logs.ts');
// Journaux du serveur muets : le nettoyage des pièces (setImmediate) écrirait sur la sortie standard, que le lanceur de
// tests lit.
reglerJournaux({ sortie: () => {} });
type Db = InstanceType<typeof Db>;
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

const PDF = Buffer.from('%PDF-1.4\n% attestation de formation SST\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);

const dir = mkdtempSync(join(tmpdir(), 'cursus-pieces-'));
const fichierBase = join(dir, 'cursus.db');
const db = new Db(fichierBase);
await migrate(db);
await appliquerMigrations(db);
await seedDemo(db);
const dossier = join(dir, 'pieces');

function ecouter(): Promise<{ serveur: Server; port: number }> {
  return new Promise(ok => { const serveur = createApp(db, { production: false, journalRequetes: false, dist: join(dir, 'sans-interface') }).listen(0, '127.0.0.1', () => ok({ serveur, port: (serveur.address() as AddressInfo).port })); });
}
let srv: Server, port: number;
before(async () => { ({ serveur: srv, port } = await ecouter()); });
after(() => {
  srv.close();
  db.sql.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Reponse { status: number; headers: IncomingHttpHeaders; corps: Buffer; json: () => Record<string, any> }
function appel(chemin: string, o: { method?: string; headers?: Record<string, string>; corps?: string | Buffer } = {}): Promise<Reponse> {
  return new Promise((ok, ko) => {
    const req = request({ host: '127.0.0.1', port, path: chemin, method: o.method ?? 'GET', headers: o.headers }, r => {
      const morceaux: Buffer[] = [];
      r.on('data', (m: Buffer) => morceaux.push(m));
      r.on('end', () => {
        const corps = Buffer.concat(morceaux);
        ok({ status: r.statusCode!, headers: r.headers, corps, json: () => JSON.parse(corps.toString('utf8')) });
      });
    }).on('error', ko);
    req.end(o.corps);
  });
}
const cookieDe = (r: Reponse) => String(r.headers['set-cookie']).match(/cursus_session=[^;]*/)![0];
const compteDe = async (empId: number | null) => ((await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', empId ? [empId] : [])) as { id: number }).id;

/** Session de démonstration de la personne dans l'espace voulu : cookie et en-tête d'espace. */
async function connexion(empId: number | null, role: 'rh' | 'manager' | 'collaborateur') {
  const premiere = await appel('/api/session');
  const r = await appel('/api/login', { method: 'POST', corps: JSON.stringify({ role, compteId: await compteDe(empId), password: 'x' }), headers: { 'content-type': 'application/json', cookie: cookieDe(premiere) } });
  assert.equal(r.status, 200, r.corps.toString());
  return { cookie: cookieDe(r), 'x-cursus-espace': role };
}
type Session = Awaited<ReturnType<typeof connexion>>;
const envoyer = async (s: Session, octets: Buffer, type: string, nom = 'arrêt de travail Benali.pdf') =>
  await appel('/api/pieces', { method: 'POST', corps: octets, headers: { ...s, 'content-type': type, 'x-nom-fichier': encodeURIComponent(nom) } });
const action = async (s: Session, nom: string, p: Record<string, unknown>) =>
  await appel(`/api/actions/${nom}`, { method: 'POST', corps: JSON.stringify(p), headers: { ...s, 'content-type': 'application/json' } });
const donnees = async (s: Session) => (await appel('/api/data', { headers: s })).json();
const regler = async (stockage: string) => { await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), piecesStockage: stockage }); };
const ligne = async (id: number) => (await db.get<Record<string, any>>('pieces', id))!;
const journalDe = async (action: string) => (await db.query('SELECT message, payload, salaries FROM journal WHERE action = ? ORDER BY id', [action])) as { message: string; payload: string; salaries: string }[];
const attendre = () => new Promise(ok => setTimeout(ok, 30));

// — Règles partagées —

test('règles : types reconnus sur le contenu, taille, nom gardé, droits de consultation', async () => {
  assert.equal(regles.typeDuContenu(PDF), 'application/pdf');
  assert.equal(regles.typeDuContenu(PNG), 'image/png');
  assert.equal(regles.typeDuContenu(JPEG), 'image/jpeg');
  assert.equal(regles.typeDuContenu(Buffer.from('<html><script>')), null);
  assert.equal(regles.typeDuContenu(Buffer.from([0x25])), null, 'trop court');
  assert.equal(regles.erreurPiece({ type: 'application/pdf', taille: 0 }), 'Fichier vide : choisissez le document scanné ou photographié.');
  assert.match(regles.erreurPiece({ type: 'application/pdf', taille: regles.TAILLE_MAX_PIECE + 1 })!, /^Fichier trop volumineux \(10 Mo\) : 10 Mo au plus\.$/);
  assert.equal(regles.erreurPiece({ type: 'text/html', taille: 10 }), 'Format refusé : PDF, JPEG ou PNG seulement.');
  assert.equal(regles.erreurPiece({ type: 'image/png', taille: 10 }), null);
  assert.equal(regles.tailleTexte(500), '1 Ko');
  assert.equal(regles.tailleTexte(2.5 * 1024 * 1024), '2,5 Mo');
  assert.equal(regles.nomPiece('C:\\Scans\\Arrêt "maladie" <1>.PDF', 'application/pdf'), 'Arrêt maladie 1.pdf');
  assert.equal(regles.nomPiece('photo.jpeg', 'image/png'), 'photo.png', 'extension du type reconnu');
  assert.equal(regles.nomPiece(undefined, 'image/jpeg'), 'piece.jpg');
  assert.equal(regles.nomPiece('x'.repeat(300), 'application/pdf').length, regles.NOM_PIECE_MAX);
  assert.ok(regles.estObjetPiece('absence') && !regles.estObjetPiece('fiche'));
  assert.ok(regles.depotOuvert('local') && !regles.depotOuvert('desactive') && !regles.depotOuvert('ged') && !regles.depotOuvert(undefined));

  const u = (role: 'rh' | 'manager' | 'collaborateur', empId: number | null, profilRh?: string) => ({ role, empId, nom: 'x', intitule: 'x', profilRh }) as User;
  const equipe = (id: number) => id === 2;
  const absence = { empId: 2, objet: 'absence' as const }, cert = { empId: 2, objet: 'certification' as const };
  assert.ok(regles.voitPiece(await u('rh', null, 'rh_gestionnaire'), absence, equipe));
  assert.ok(regles.voitPiece(await u('rh', null, 'referent_hse'), cert, equipe) && !regles.voitPiece(await u('rh', null, 'referent_hse'), absence, equipe));
  assert.ok(!regles.voitPiece(await u('rh', null, 'paie'), cert, equipe) && !regles.voitPiece(await u('rh', null, 'lecture_seule'), cert, equipe));
  assert.ok(regles.voitPiece(await u('manager', 12), cert, equipe) && !regles.voitPiece(await u('manager', 12), absence, equipe), 'jamais la santé pour le manager');
  assert.ok(!regles.voitPiece(await u('manager', 12), { empId: 6, objet: 'habTitre' }, equipe), 'hors de son équipe');
  assert.ok(regles.voitPiece(await u('collaborateur', 2), absence, equipe) && !regles.voitPiece(await u('collaborateur', 6), absence, equipe));
  const liste = [{ id: 1, objet: 'absence', objetId: 4, retireeLe: null }, { id: 2, objet: 'absence', objetId: 4, retireeLe: '2026-10-01' }] as never[];
  assert.deepEqual(regles.piecesDe(liste, 'absence', 4).map((p: { id: number }) => p.id), [1]);
  assert.deepEqual(regles.piecesDe(liste, 'absence', null), []);
});

test('réglage : désactivé par défaut, dossier local accepté, GED refusée tant qu’elle n’est pas raccordée', () => {
  assert.equal(DEFAULT_SETTINGS.piecesStockage, 'desactive');
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { piecesStockage: 'local' }).piecesStockage, 'local');
  assert.equal(appliquerReglages(DEFAULT_SETTINGS, { piecesStockage: 'nimporte' }).piecesStockage, 'desactive');
  assert.throws(() => appliquerReglages(DEFAULT_SETTINGS, { piecesStockage: 'ged' }), (e: unknown) => e instanceof ReglageInvalide && /GED\) pas encore raccordé/.test((e as Error).message));
});

test('adaptateur GED : chaque appel refusé ; noms stockés reconnus', async () => {
  const ged = new DepotGed();
  assert.equal(ged.mode, 'ged');
  await assert.rejects(ged.ecrire(PDF), { message: GED_NON_RACCORDEE });
  await assert.rejects(ged.lire('ged:42'), { message: GED_NON_RACCORDEE });
  await assert.rejects(ged.supprimer('ged:42'), { message: GED_NON_RACCORDEE });
  assert.ok(estFichierGed('ged:42') && !estFichierGed('a'.repeat(32)));
  assert.equal(pieces.depotDe(db, 'ged:42').mode, 'ged');
  assert.equal(pieces.contenuLocal(db, 'ged:42'), null);
  assert.equal(pieces.contenuLocal(db, '../cursus.db'), null, 'jamais un chemin');
  // Réglage forcé à « ged » en base (hors de l'écran) : aucun dépôt local, l'adaptateur refuse.
  await regler('ged');
  assert.equal((await pieces.depotEcriture(db))?.mode, 'ged');
  await regler('desactive');
  assert.equal(await pieces.depotEcriture(db), null);
});

test('CSRF : un fichier PDF, JPEG ou PNG n’est admis que sur l’envoi des pièces', () => {
  const req = (path: string, type: string) => ({ method: 'POST', path, get: (h: string) => ({ 'content-type': type, 'content-length': '10' } as Record<string, string>)[h], host: '127.0.0.1' }) as never;
  assert.equal(refusCsrf(req('/api/pieces', 'application/pdf')), null);
  assert.equal(refusCsrf(req('/api/pieces', 'text/plain')), 'corps JSON attendu');
  assert.equal(refusCsrf(req('/api/actions/parametres.maj', 'application/pdf')), 'corps JSON attendu');
});

// — Parcours HTTP —

test('envoi : désactivé par défaut, puis contrôle du contenu, de la taille et du type ; fichier en 600, en attente', async () => {
  const mehdi = await connexion(2, 'collaborateur');
  assert.equal((await appel('/api/pieces', { method: 'POST', corps: PDF, headers: { 'content-type': 'application/pdf' } })).status, 401);
  const desactive = await envoyer(mehdi, PDF, 'application/pdf');
  assert.equal(desactive.status, 409);
  assert.match(desactive.json().error, /^Pièces justificatives désactivées/);
  await regler('local');
  // Espace affiché différent de celui de la session : rien n'est reçu.
  assert.equal((await envoyer({ ...mehdi, 'x-cursus-espace': 'rh' }, PDF, 'application/pdf')).status, 409);
  const html = await envoyer(mehdi, Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf');
  assert.equal(html.status, 415, 'page HTML renommée en .pdf');
  // Type déclaré différent du contenu (photo JPEG nommée .png) : le type reconnu sur le contenu est gardé.
  const renomme = await envoyer(mehdi, JPEG, 'image/png', 'avis.png');
  assert.equal(renomme.status, 201, renomme.corps.toString());
  assert.deepEqual([renomme.json().type, renomme.json().nom, (await ligne(renomme.json().id)).type], ['image/jpeg', 'avis.jpg', 'image/jpeg']);
  await db.remove('pieces', renomme.json().id);
  assert.equal((await envoyer(mehdi, Buffer.alloc(0), 'application/pdf')).status, 400);
  const texte = await envoyer(mehdi, Buffer.from('bonjour'), 'text/plain');
  assert.equal(texte.status, 403, 'texte brut : refus CSRF');
  const gros = await envoyer(mehdi, Buffer.concat([PDF, Buffer.alloc(regles.TAILLE_MAX_PIECE)]), 'application/pdf');
  assert.equal(gros.status, 413);
  assert.equal(gros.json().error, 'Fichier trop volumineux : 10 Mo au plus.');

  const ok = await envoyer(mehdi, PDF, 'application/pdf');
  assert.equal(ok.status, 201, ok.corps.toString());
  const r = ok.json();
  assert.equal(r.nom, 'arrêt de travail Benali.pdf');
  assert.equal(r.taille, PDF.length);
  assert.ok(r.jeton.length >= 32);
  const p = await ligne(r.id);
  assert.equal(p.objet, null);
  assert.equal(p.deposeCompteId, await compteDe(2));
  assert.match(p.fichier, pieces.NOM_LOCAL);
  assert.equal(p.empreinte, pieces.empreinte(PDF));
  assert.deepEqual(readFileSync(join(dossier, p.fichier)), PDF);
  assert.equal(statSync(join(dossier, p.fichier)).mode & 0o777, 0o600);
  assert.equal(statSync(dossier).mode & 0o777, 0o700);
  // Journal : type et taille, jamais le nom du fichier (il nomme ici un arrêt de travail).
  const j = (await journalDe('piece.deposer')).at(-1)!;
  assert.doesNotMatch(j.message + j.payload, /arrêt|Benali/);
  assert.deepEqual(JSON.parse(j.payload), { piece: r.id, type: 'application/pdf', taille: PDF.length });
  // En attente : seul son compte la relit ; l'instantané ne la transmet à personne.
  assert.equal((await appel(`/api/pieces/${r.id}`, { headers: mehdi })).status, 200);
  const admin = await connexion(null, 'rh');
  assert.equal((await appel(`/api/pieces/${r.id}`, { headers: admin })).status, 404);
  assert.ok(!(await donnees(admin)).pieces.some((x: { id: number }) => x.id === r.id));
  // Plus de 20 pièces en attente pour un compte : refus.
  for (let i = 0; i < regles.MAX_PIECES_EN_ATTENTE; i++) assert.equal((await envoyer(admin, PNG, 'image/png', 'scan.png')).status, 201);
  assert.equal((await envoyer(admin, PNG, 'image/png')).status, 429);
  (await db.run('DELETE FROM pieces WHERE depose_compte_id = ?', [await compteDe(null)]));
  // Enregistrement impossible après l'écriture du fichier : le fichier est effacé, réponse 500 sans détail.
  const avant = readdirSync(dossier).length;
  const insert = db.insert.bind(db);
  const lignesServeur: string[] = [];
  const retablir = reglerJournaux({ format: 'json', sortie: l => { lignesServeur.push(l); } });
  db.insert = ((t: string, o: Record<string, unknown>) => { if (t === 'pieces') throw new Error('panne simulée'); return insert(t as never, o); }) as typeof db.insert;
  try {
    const panne = await envoyer(admin, PDF, 'application/pdf');
    assert.equal(panne.status, 500);
    assert.deepEqual(panne.json(), { error: 'Erreur interne' });
  } finally {
    db.insert = insert;
    retablir();
  }
  assert.equal(readdirSync(dossier).length, avant);
  assert.ok(lignesServeur.some(l => l.includes('panne simulée')));
});

test('justificatif d’absence : joint au signalement par l’intéressé, vu de lui et du RH, jamais du manager ; consultation tracée', async () => {
  await regler('local');
  const mehdi = await connexion(2, 'collaborateur'), karim = await connexion(12, 'manager'), thomas = await connexion(6, 'collaborateur');
  const gest = await connexion(14, 'rh'), hse = await connexion(23, 'rh'), paie = await connexion(7, 'rh'), lect = await connexion(11, 'rh');
  const { jeton, id } = (await envoyer(mehdi, PDF, 'application/pdf')).json();
  // Le jeton ne vaut que pour le compte qui a envoyé la pièce.
  const vole = await action(karim, 'absence.signaler', { empId: 12, du: '2026-11-02', au: '2026-11-02', pieces: [jeton] });
  assert.equal(vole.status, 400);
  assert.match(vole.json().error, /^Pièce introuvable ou déjà jointe/);
  // Le manager qui signale pour un membre ne joint jamais de justificatif.
  assert.equal((await action(karim, 'absence.signaler', { empId: 2, du: '2026-11-03', au: '2026-11-03', pieces: [jeton] })).status, 403);
  const sig = await action(mehdi, 'absence.signaler', { empId: 2, du: '2026-11-04', au: '2026-11-05', pieces: [jeton] });
  assert.equal(sig.status, 200, sig.corps.toString());
  assert.match(sig.json().message, / · 1 pièce jointe$/);
  const p = await ligne(id);
  const absence = (await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-11-04'`)) as { id: number };
  assert.deepEqual([p.objet, p.objetId, p.empId, p.jeton], ['absence', absence.id, 2, null]);
  // Déjà jointe : le même jeton ne sert plus.
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [jeton], objet: 'absence', objetId: absence.id })).status, 400);

  const voit = async (s: Session) => (await donnees(s)).pieces.some((x: { id: number }) => x.id === id);
  assert.ok(await voit(mehdi), 'l’intéressé');
  assert.ok(await voit(gest), 'le service RH');
  for (const [nom, s] of [['manager', karim], ['autre collaborateur', thomas], ['référent HSE', hse], ['paie', paie], ['lecture seule', lect]] as const) {
    assert.ok(!(await voit(s)), nom);
    const r = await appel(`/api/pieces/${id}`, { headers: s });
    assert.equal(r.status, 404, nom);
  }
  const refus = (await db.one(`SELECT message FROM journal WHERE action = 'acces.refuse' AND message LIKE 'Pièce justificative%' ORDER BY id DESC`)) as { message: string };
  assert.match(refus.message, /^Pièce justificative — Justificatif d’absence hors de vos droits$/);
  const rh = await appel(`/api/pieces/${id}`, { headers: gest });
  assert.equal(rh.status, 200);
  assert.deepEqual(rh.corps, PDF);
  assert.equal(rh.headers['content-type'], 'application/pdf');
  assert.equal(rh.headers['cache-control'], 'no-store');
  assert.match(String(rh.headers['content-security-policy']), /^default-src 'none'/);
  assert.equal(rh.headers['content-disposition'], `inline; filename="arret de travail Benali.pdf"; filename*=UTF-8''${encodeURIComponent('arrêt de travail Benali.pdf')}`);
  const dl = await appel(`/api/pieces/${id}?telecharger=1`, { headers: gest });
  assert.match(String(dl.headers['content-disposition']), /^attachment; /);
  // Une seule ligne de consultation par compte et par pièce pendant 15 minutes, sans le nom du fichier.
  const consultations = (await journalDe('piece.consulter')).filter(l => JSON.parse(l.payload).piece === id);
  assert.equal(consultations.length, 1);
  assert.equal(consultations[0].message, 'Pièce justificative consultée (justificatif d’absence)');
  assert.deepEqual(JSON.parse(consultations[0].salaries), [2]);
  // Le service RH qualifie : la pièce reste jointe ; le journal compte les pièces jointes par l'action, sans jeton.
  const autre = (await envoyer(gest, PNG, 'image/png', 'avis.png')).json();
  const q = await action(gest, 'absence.qualifier', { id: absence.id, nature: 'MALADIE', justificatif: true, justificatifLe: '2026-10-10', pieces: [autre.jeton] });
  assert.equal(q.status, 200, q.corps.toString());
  const qj = (await db.one(`SELECT payload FROM journal WHERE action = 'absence.qualifier' ORDER BY id DESC`)) as { payload: string };
  assert.equal(JSON.parse(qj.payload).pieces, 1);
  assert.doesNotMatch(qj.payload, new RegExp(autre.jeton));
  // Un congé ne reçoit pas de justificatif ; une absence annulée non plus.
  const conge = await db.insert<{ id: number }>('absences', { empId: 2, type: 'CP', du: '2026-12-21', au: '2026-12-21', statut: 'validee', keystone: false, justificatif: false });
  const j2 = (await envoyer(mehdi, PDF, 'application/pdf')).json().jeton;
  assert.match((await action(mehdi, 'piece.joindre', { jetons: [j2], objet: 'absence', objetId: conge.id })).json().error, /^Un congé ne demande pas/);
  await db.update('absences', conge.id, { type: 'ABSENCE', statut: 'annulee' });
  assert.match((await action(mehdi, 'piece.joindre', { jetons: [j2], objet: 'absence', objetId: conge.id })).json().error, /^Absence annulée ou refusée/);
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [j2], objet: 'absence', objetId: 999999 })).status, 404);
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [j2], objet: 'fiche', objetId: 1 })).status, 400);
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [j2], objet: 'absence', objetId: 'x' })).status, 404);
  assert.match((await action(mehdi, 'piece.joindre', { jetons: [], objet: 'absence', objetId: absence.id })).json().error, /^Aucune pièce à joindre$/);
  assert.match((await action(mehdi, 'piece.joindre', { jetons: Array.from({ length: 11 }, (_, i) => `j${i}`), objet: 'absence', objetId: absence.id })).json().error, /^10 pièces au plus/);
  const jointe = await action(mehdi, 'piece.joindre', { jeton: j2, objet: 'absence', objetId: absence.id });
  assert.equal(jointe.json().message, 'Justificatif d’absence — 1 pièce jointe');
});

test('justificatif joint après la qualification : la réception reste au RH, qui le voit « à vérifier », comme le salarié', async () => {
  await regler('local');
  const mehdi = await connexion(2, 'collaborateur'), gest = await connexion(14, 'rh'), karim = await connexion(12, 'manager');
  const sig = await action(mehdi, 'absence.signaler', { empId: 2, du: '2026-11-16', au: '2026-11-17' });
  assert.equal(sig.status, 200, sig.corps.toString());
  const absence = (await db.one(`SELECT id FROM absences WHERE emp_id = 2 AND du = '2026-11-16'`)) as { id: number };
  // Qualifiée sans justificatif : elle sort des absences à qualifier.
  assert.equal((await action(gest, 'absence.qualifier', { id: absence.id, nature: 'MALADIE', justificatif: false })).status, 200);
  const etat = async (s: Session) => {
    const ds = await donnees(s);
    return regles.justificatifAVerifier(ds.absences.find((a: { id: number }) => a.id === absence.id), ds.pieces);
  };
  assert.equal(await etat(gest), false, 'aucune pièce : justificatif attendu');
  // Deux jours plus tard, Mehdi envoie son avis d'arrêt par « Justificatif » (piece.joindre).
  const { jeton } = (await envoyer(mehdi, PDF, 'application/pdf')).json();
  const r = await action(mehdi, 'piece.joindre', { jetons: [jeton], objet: 'absence', objetId: absence.id });
  assert.equal(r.status, 200, r.corps.toString());
  assert.equal(r.json().message, 'Justificatif d’absence — 1 pièce jointe, à vérifier par le service RH');
  assert.equal((await (await db.get<{ justificatif: boolean }>('absences', absence.id))!).justificatif, false, 'réception décidée par le service RH');
  assert.equal(await etat(gest), true, 'visible du service RH : « justificatif joint, à vérifier »');
  assert.equal(await etat(mehdi), true, 'et du salarié');
  assert.equal(await etat(karim), false, 'jamais du manager (aucune pièce de santé transmise)');
  // Le service RH l'ouvre et inscrit la réception : plus rien à vérifier.
  assert.equal((await action(gest, 'absence.qualifier', { id: absence.id, nature: 'MALADIE', justificatif: true, justificatifLe: '2026-10-10' })).status, 200);
  assert.equal(await etat(gest), false);
  assert.equal(regles.justificatifAVerifier({ id: 1, statut: 'annulee', justificatif: false }, [{ objet: 'absence', objetId: 1, retireeLe: null }] as never[]), false, 'absence annulée');
});

test('retrait sur son propre dossier refusé ; 10 pièces en vigueur au plus par objet', async () => {
  await regler('local');
  const gest = await connexion(14, 'rh'), mehdi = await connexion(2, 'collaborateur');
  // Antoine Leroy (gestionnaire RH, salarié n° 14) ne retire pas le justificatif de sa propre absence.
  const sienne = await db.insert<{ id: number }>('absences', { empId: 14, type: 'ABSENCE', du: '2026-12-02', au: '2026-12-02', statut: 'signalee', keystone: true, justificatif: false });
  const p = await db.insert<{ id: number }>('pieces', { empId: 14, objet: 'absence', objetId: sienne.id, nom: 'a.pdf', type: 'application/pdf', taille: 1, fichier: 'd'.repeat(32), deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
  const refus = await action(gest, 'piece.retirer', { id: p.id, motif: 'test' });
  assert.equal(refus.status, 403);
  assert.match(refus.json().error, /^Vous ne pouvez pas retirer une pièce de votre propre dossier : la décision revient /);
  assert.equal((await ligne(p.id)).retireeLe, null);
  assert.equal((await ligne(p.id)).fichier, 'd'.repeat(32), 'fichier gardé');
  await db.remove('pieces', p.id);
  await db.remove('absences', sienne.id);
  // Plafond par objet : le dépôt ne se remplit pas de pièces jointes en boucle à la même absence.
  const a = await db.insert<{ id: number }>('absences', { empId: 2, type: 'ABSENCE', du: '2026-12-03', au: '2026-12-03', statut: 'signalee', keystone: true, justificatif: false });
  const ids: number[] = [];
  for (let i = 0; i < regles.MAX_PIECES_PAR_OBJET - 1; i++) ids.push((await db.insert<{ id: number }>('pieces', {
    empId: 2, objet: 'absence', objetId: a.id, nom: 'a.pdf', type: 'application/pdf', taille: 1, fichier: String(i).padStart(32, 'f'), deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x',
  })).id);
  const deux = [(await envoyer(mehdi, PDF, 'application/pdf')).json().jeton, (await envoyer(mehdi, PNG, 'image/png')).json().jeton];
  const trop = await action(mehdi, 'piece.joindre', { jetons: deux, objet: 'absence', objetId: a.id });
  assert.equal(trop.status, 400);
  assert.equal(trop.json().error, '10 pièces au plus par objet (9 déjà jointes) : retirez d’abord celles qui ne servent plus');
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [deux[0]], objet: 'absence', objetId: a.id })).status, 200, 'la dixième passe');
  // Une pièce retirée ne compte plus.
  await db.update('pieces', ids[0], { retireeLe: '2026-10-02T08:00:00.000Z', retireePar: 'x', retireeMotif: 'x' });
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [deux[1]], objet: 'absence', objetId: a.id })).status, 200);
  (await db.run('DELETE FROM pieces WHERE objet = ? AND objet_id = ?', ['absence', a.id]));
  await db.remove('absences', a.id);
});

test('certification et titre d’habilitation : RH et référent HSE, le manager de l’équipe les voit, ni la paie ni la lecture seule', async () => {
  await regler('local');
  const hse = await connexion(23, 'rh'), karim = await connexion(12, 'manager'), hugo = await connexion(16, 'manager'), paie = await connexion(7, 'rh'), lect = await connexion(11, 'rh');
  const mehdi = await connexion(2, 'collaborateur');
  const { jeton, id } = (await envoyer(hse, JPEG, 'image/jpeg', 'carte CACES.jpg')).json();
  const r = await action(hse, 'cert.ajouter', { empId: 2, f: 'sst', date: '2026-10-01', pieces: [jeton] });
  assert.equal(r.status, 200, r.corps.toString());
  assert.match(r.json().message, / · 1 pièce jointe/);
  assert.equal((await ligne(id)).objet, 'certification');
  for (const s of [karim, mehdi, hse]) assert.equal((await appel(`/api/pieces/${id}`, { headers: s })).status, 200);
  for (const s of [hugo, paie, lect]) assert.equal((await appel(`/api/pieces/${id}`, { headers: s })).status, 404);
  const vue = (await donnees(karim)).pieces.find((x: { id: number }) => x.id === id);
  assert.ok(vue && vue.empreinte === null, 'description sans empreinte hors du service RH');
  assert.deepEqual((await donnees(paie)).pieces, []);
  assert.deepEqual((await donnees(lect)).pieces, []);
  assert.ok((await donnees(hse)).pieces.some((x: { id: number }) => x.id === id));
  // Délivrance avec le titre signé : jointe au titre (créé ou mis à jour).
  const t = (await envoyer(hse, PDF, 'application/pdf', 'titre B1V signé.pdf')).json();
  const deliv = await action(hse, 'hab.delivrer', { empId: 2, h: 'hauteur', date: '2026-10-09', par: 'Direction du site', mode: 'renew', pieces: [t.jeton] });
  assert.equal(deliv.status, 200, deliv.corps.toString());
  assert.equal((await ligne(t.id)).objet, 'habTitre');
  // Le référent HSE retire une attestation, jamais un justificatif d'absence ; motif exigé.
  assert.equal((await action(hse, 'piece.retirer', { id, motif: '' })).status, 400);
  assert.match((await action(hse, 'piece.retirer', { id, motif: 'x'.repeat(501) })).json().error, /^Motif trop long/);
  assert.equal((await action(karim, 'piece.retirer', { id, motif: 'Erreur' })).status, 403);
  const retrait = await action(hse, 'piece.retirer', { id, motif: 'Carte d’un autre salarié' });
  assert.equal(retrait.status, 200);
  assert.match(retrait.json().message, /^Pièce retirée du dossier \(attestation de formation\)/);
  await attendre();
  const apres = await ligne(id);
  assert.ok(apres.retireeLe && apres.fichier === null, 'fichier effacé après la validation');
  assert.equal(readdirSync(dossier).filter(f => f === apres.fichier).length, 0);
  assert.equal((await appel(`/api/pieces/${id}`, { headers: karim })).status, 410, 'retirée : fichier effacé');
  assert.ok(!(await donnees(karim)).pieces.some((x: { id: number }) => x.id === id), 'retirée : plus transmise au manager');
  const admin = await connexion(null, 'rh');
  assert.equal((await appel(`/api/pieces/${id}`, { headers: admin })).status, 410);
  assert.ok((await donnees(admin)).pieces.some((x: { id: number; retireeLe: string | null }) => x.id === id && x.retireeLe), 'historique au service RH');
  assert.equal((await action(hse, 'piece.retirer', { id, motif: 'encore' })).json().message, 'Pièce déjà retirée');
  assert.equal((await action(hse, 'piece.retirer', { id: 999999, motif: 'x' })).status, 404);
  // Journal du retrait : identifiants et objet, le motif masqué.
  const j = (await db.one(`SELECT payload FROM journal WHERE action = 'piece.retirer' AND payload LIKE '%"apres"%' ORDER BY id DESC`)) as { payload: string };
  const payload = JSON.parse(j.payload);
  assert.equal(payload.objet, 'certification');
  assert.equal(payload.apres.retireeMotif, '[texte renseigné]');
  assert.doesNotMatch(j.payload, /autre salarié/);
  const absence = await db.insert<{ id: number }>('absences', { empId: 2, type: 'ABSENCE', du: '2026-12-01', au: '2026-12-01', statut: 'signalee', keystone: true, justificatif: false });
  const pa = await db.insert<{ id: number }>('pieces', { empId: 2, objet: 'absence', objetId: absence.id, nom: 'a.pdf', type: 'application/pdf', taille: 1, fichier: 'c'.repeat(32), deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
  assert.equal((await action(hse, 'piece.retirer', { id: pa.id, motif: 'x' })).status, 403);
  await db.remove('pieces', pa.id);
});

test('document déclaré : copie lue par le RH avant validation, gardée si la déclaration est remplacée, effacée au refus', async () => {
  await regler('local');
  const mehdi = await connexion(2, 'collaborateur'), admin = await connexion(null, 'rh'), karim = await connexion(12, 'manager');
  const a = (await envoyer(mehdi, PDF, 'application/pdf', 'passeport.pdf')).json();
  const decl = await action(mehdi, 'formalite.enregistrer', { empId: 2, kind: 'passeport', numero: '21XY12345', expire: '2033-01-01', pieces: [a.jeton] });
  assert.equal(decl.status, 200, decl.corps.toString());
  assert.match(decl.json().message, / · 1 pièce jointe$/);
  const premiere = (await ligne(a.id)).objetId;
  // Nouvelle déclaration du même document : elle remplace la précédente et garde sa copie.
  const b = (await envoyer(mehdi, PNG, 'image/png', 'passeport-page2.png')).json();
  await action(mehdi, 'formalite.enregistrer', { empId: 2, kind: 'passeport', numero: '21XY12346', expire: '2033-01-01', pieces: [b.jeton] });
  const seconde = (await ligne(b.id)).objetId;
  assert.notEqual(seconde, premiere);
  assert.equal((await ligne(a.id)).objetId, seconde, 'pièce de la déclaration remplacée rattachée à la nouvelle');
  assert.equal((await appel(`/api/pieces/${a.id}`, { headers: karim })).status, 404, 'jamais au manager');
  assert.equal((await appel(`/api/pieces/${a.id}`, { headers: admin })).status, 200);
  // Pièce ajoutée ensuite par l'intéressé tant que la déclaration attend ; par un autre, refus.
  const c = (await envoyer(mehdi, PDF, 'application/pdf')).json();
  assert.equal((await action(mehdi, 'piece.joindre', { jetons: [c.jeton], objet: 'declaration', objetId: seconde })).status, 200);
  const d2 = (await envoyer(karim, PDF, 'application/pdf')).json();
  assert.equal((await action(karim, 'piece.joindre', { jetons: [d2.jeton], objet: 'declaration', objetId: seconde })).status, 403);
  const formation = (await db.one(`SELECT id FROM demandes_collab WHERE type <> 'document' LIMIT 1`)) as { id: number };
  assert.match((await action(admin, 'piece.joindre', { jetons: [(await envoyer(admin, PDF, 'application/pdf')).json().jeton], objet: 'declaration', objetId: formation.id })).json().error, /^Seul un document déclaré/);
  const refus = await action(admin, 'demande.refuser', { id: seconde, motif: 'Copie illisible' });
  assert.equal(refus.status, 200, refus.corps.toString());
  assert.match(refus.json().message, / · 3 pièces jointes effacées$/);
  await attendre();
  for (const id of [a.id, b.id, c.id]) assert.ok((await ligne(id)).retireeLe && !(await ligne(id)).fichier, `pièce ${id} effacée`);
});

test('déplacement : pièce jointe par le service RH seulement ; fonction désactivée : plus d’envoi, les pièces restent lisibles', async () => {
  await regler('local');
  const admin = await connexion(null, 'rh');
  const v = await db.insert<{ id: number }>('voyages', { empId: 2, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier', origine: 'cursus', ref: null, chantier: null });
  const p = (await envoyer(admin, PDF, 'application/pdf', 'ordre de mission.pdf')).json();
  assert.equal((await action(admin, 'piece.joindre', { jetons: [p.jeton], objet: 'voyage', objetId: v.id })).status, 200);
  await regler('desactive');
  assert.equal((await appel(`/api/pieces/${p.id}`, { headers: admin })).status, 200, 'consultable après la désactivation');
  const q = await db.insert<{ id: number }>('pieces', { jeton: 'reste', nom: 'x.pdf', type: 'application/pdf', taille: 1, fichier: 'd'.repeat(32), deposeLe: new Date().toISOString(), deposePar: 'x', deposeCompteId: await compteDe(null) });
  const r = await action(admin, 'piece.joindre', { jetons: ['reste'], objet: 'voyage', objetId: v.id });
  assert.equal(r.status, 409);
  await db.remove('pieces', q.id);
});

test('empreinte et fichier : contenu altéré refusé (409), fichier disparu (410) ; contrôle d’intégrité', async () => {
  await regler('local');
  const admin = await connexion(null, 'rh');
  const a = await db.insert<{ id: number }>('absences', { empId: 3, type: 'ABSENCE', du: '2026-12-02', au: '2026-12-02', statut: 'signalee', keystone: true, justificatif: false });
  const p = (await envoyer(admin, PDF, 'application/pdf')).json();
  await action(admin, 'piece.joindre', { jetons: [p.jeton], objet: 'absence', objetId: a.id });
  const f = join(dossier, (await ligne(p.id)).fichier);
  assert.deepEqual(await pieces.controlerPieces(db), {});
  chmodSync(f, 0o600);
  writeFileSync(f, Buffer.concat([PDF.subarray(0, PDF.length - 1), Buffer.from('X')]));
  assert.equal((await appel(`/api/pieces/${p.id}`, { headers: admin })).status, 409, 'même taille, autre contenu');
  writeFileSync(f, Buffer.concat([PDF, Buffer.from('ajout')]));
  assert.deepEqual(await pieces.controlerPieces(db), { 'pieces.fichier → dossier des pièces (taille différente)': 1 });
  rmSync(f);
  assert.equal((await appel(`/api/pieces/${p.id}`, { headers: admin })).status, 410);
  const ctrl = await controlerOrphelins(db);
  assert.equal(ctrl.parReference['pieces.fichier → dossier des pièces (absent)'], 1);
  // Objet disparu (reprise hors de Cursus) : référence orpheline de la table de l'objet.
  (await db.run('DELETE FROM absences WHERE id = ?', [a.id]));
  assert.equal((await controlerOrphelins(db)).parReference['pieces.objet_id → absences'], 1);
  (await db.run('DELETE FROM pieces WHERE id = ?', [p.id]));
  assert.deepEqual(Object.keys((await controlerOrphelins(db)).parReference).filter(k => k.startsWith('pieces')), []);
});

test('export des données personnelles : description et contenu en base64, ni nom stocké ni jeton', async () => {
  await regler('local');
  const admin = await connexion(null, 'rh');
  const a = await db.insert<{ id: number }>('absences', { empId: 4, type: 'ABSENCE', du: '2026-12-03', au: '2026-12-03', statut: 'signalee', keystone: true, justificatif: false });
  const p = (await envoyer(admin, PNG, 'image/png', 'avis.png')).json();
  await action(admin, 'piece.joindre', { jetons: [p.jeton], objet: 'absence', objetId: a.id });
  const x = (await donneesSalarie(db, 4, { journal: false, par: 'Essai' }))!;
  const section = x.sections['Pièces justificatives'] as Record<string, unknown>[];
  assert.equal(section.length, 1);
  assert.equal(section[0].nom, 'avis.png');
  assert.equal(Buffer.from(String(section[0].contenu), 'base64').compare(PNG), 0);
  for (const k of ['fichier', 'jeton', 'deposeCompteId']) assert.ok(!(k in section[0]), k);
  const http = await appel('/api/salaries/4/donnees', { headers: admin });
  assert.equal(http.status, 200);
  assert.equal(JSON.parse(http.corps.toString()).sections['Pièces justificatives'].length, 1);
});

test('nettoyage : pièces en attente de plus de 24 h et fichiers sans pièce effacés ; un envoi récent est gardé', async () => {
  const vieux = new Date(Date.now() - 25 * 3600_000);
  const depot = pieces.depotLocal(db);
  const enAttente = await depot.ecrire(PDF);
  const p = await db.insert<{ id: number }>('pieces', { jeton: 'vieux', nom: 'x.pdf', type: 'application/pdf', taille: PDF.length, fichier: enAttente, deposeLe: vieux.toISOString(), deposePar: 'x', deposeCompteId: 1 });
  const orphelin = await depot.ecrire(PDF);
  utimesSync(join(dossier, orphelin), vieux, vieux);
  const recent = await depot.ecrire(PDF);
  writeFileSync(join(dossier, 'etranger.txt'), 'ne pas toucher');
  const b = await pieces.nettoyerPieces(db);
  assert.ok(b.enAttente >= 1 && b.orphelins >= 1, JSON.stringify(b));
  assert.equal(await db.get('pieces', p.id), undefined);
  assert.ok(!existsSync(join(dossier, enAttente)) && !existsSync(join(dossier, orphelin)));
  assert.ok(existsSync(join(dossier, recent)) && existsSync(join(dossier, 'etranger.txt')));
  assert.match(pieces.bilanTexte({ enAttente: 2, retirees: 1, orphelins: 1 }), /^2 pièces en attente effacées · 1 fichier de pièce retirée effacé · 1 fichier sans pièce effacé$/);
  assert.equal(pieces.bilanTexte({ enAttente: 0, retirees: 0, orphelins: 0 }), '');
  await depot.supprimer(recent);
  rmSync(join(dossier, 'etranger.txt'));
  const arreter = await pieces.demarrerPieces(db);
  arreter();
  pieces.nettoyerBientot(db);
  await attendre();
  assert.equal(await depot.lire('../x'), null);
  await assert.rejects(depot.supprimer('../x'), /Nom de pièce invalide/);
  assert.equal(await depot.lire('f'.repeat(32)), null);
});

test('instantané : pièces visibles selon le profil (fonctions du serveur)', async () => {
  const full = async (u: User) => await loadFull(db, u);
  const user = async (empId: number | null, role: 'rh' | 'manager' | 'collaborateur') => (await currentUser(db, { compteId: await compteDe(empId), role, methode: 'demo' }))!;
  const toutes = (await full(await user(null, 'rh'))).pieces!;
  assert.ok(toutes.length > 0);
  assert.ok(toutes.every(p => !('fichier' in p) && !('jeton' in p)), 'ni nom stocké ni jeton, même pour le service RH');
  assert.equal((await buildSnapshot(db, await user(null, 'rh'))).pieces!.length, toutes.length);
  assert.ok((await buildSnapshot(db, await user(23, 'rh'))).pieces!.every(p => p.objet === 'certification' || p.objet === 'habTitre'));
  assert.ok((await buildSnapshot(db, await user(12, 'manager'))).pieces!.every(p => p.objet === 'certification' || p.objet === 'habTitre' || p.empId === 12));
  assert.ok((await buildSnapshot(db, await user(2, 'collaborateur'))).pieces!.every(p => p.empId === 2 && !p.retireeLe));
  assert.deepEqual(pieces.piecesVisibles(undefined, await user(2, 'collaborateur')), []);
  // Action sans compte (lecture interne) : le jeton seul suffit.
  const ctx = makeCtx(db, { role: 'rh', empId: null, nom: 'Interne', intitule: 'x', profilRh: 'rh_admin' }, await loadFull(db, await user(null, 'rh')));
  await regler('local');
  const ctxLocal = makeCtx(db, ctx.user, await loadFull(db, await user(null, 'rh')));
  await db.insert('pieces', { jeton: 'interne', nom: 'x.pdf', type: 'application/pdf', taille: 1, fichier: 'e'.repeat(32), deposeLe: new Date().toISOString(), deposePar: 'x', deposeCompteId: 99 });
  const v = await db.insert<{ id: number }>('voyages', { empId: 5, dest: 'MA', depart: '2026-11-02', retour: '2026-11-06', motif: 'Chantier', origine: 'cursus', ref: null, chantier: null });
  assert.equal(((await ACTIONS['piece.joindre'](ctxLocal, { jetons: ['interne'], objet: 'voyage', objetId: v.id })) as { message: string }).message, 'Pièce du dossier de déplacement — 1 pièce jointe');
  await assert.rejects(async () => await ACTIONS['piece.joindre'](makeCtx(db, await user(2, 'collaborateur'), await loadFull(db, await user(2, 'collaborateur'))), { jetons: ['x'], objet: 'voyage', objetId: v.id }),
    (e: unknown) => e instanceof ActionError && e.status === 403);
});

test('sauvegarde et restauration : fichiers emportés avec chaque copie, retirés après la rotation, remis à la restauration', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cursus-pieces-sauvegarde-'));
  const file = join(base, 'cursus.db');
  const autre = new Db(file);
  try {
    await seedDemo(autre);
    const depot = pieces.depotLocal(autre);
    const f1 = await depot.ecrire(PDF), f2 = await depot.ecrire(PNG);
    const ligneDe = (f: string, empId: number) => ({ empId, objet: 'certification', objetId: 1, nom: 'x.pdf', type: 'application/pdf', taille: 1, fichier: f, deposeLe: '2026-10-01T08:00:00.000Z', deposePar: 'x' });
    await autre.insert('pieces', ligneDe(f1, 1));
    const p2 = await autre.insert<{ id: number }>('pieces', ligneDe(f2, 2));
    await autre.insert('pieces', ligneDe('ged:7', 3));
    const backups = join(base, 'backups'), miroir = join(backups, 'pieces-cursus');
    const jour = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 2, 15));
    const s1 = sauvegarder(file, { date: jour(1), keep: 2 });
    assert.deepEqual(s1.pieces, { designees: 2, copiees: 2, manquantes: 0, retirees: 0 });
    assert.deepEqual(readdirSync(miroir).sort(), [f1, f2].sort());
    assert.equal(statSync(join(miroir, f1)).mode & 0o777, 0o600);
    assert.deepEqual(fichiersDesignes(s1.fichier).sort(), [f1, f2].sort(), 'la GED garde ses propres copies');
    // Pièce retirée : la copie suivante ne la désigne plus, mais les deux copies conservées en tiennent compte.
    await autre.update('pieces', p2.id, { fichier: null, retireeLe: '2026-10-02T08:00:00.000Z' });
    await depot.supprimer(f2);
    const s2 = sauvegarder(file, { date: jour(2), keep: 2 });
    assert.deepEqual(s2.pieces, { designees: 1, copiees: 0, manquantes: 0, retirees: 0 });
    assert.ok(existsSync(join(miroir, f2)), 'gardée tant que la première copie la désigne');
    const s3 = sauvegarder(file, { date: jour(3), keep: 2 });
    assert.equal(s3.pieces!.retirees, 1, 'la première copie partie, son fichier aussi');
    assert.deepEqual(readdirSync(miroir), [f1]);
    // Fichier disparu du dossier des pièces : signalé, la copie reste faite.
    await depot.supprimer(f1);
    const s4 = sauvegarder(file, { date: jour(4), keep: 2 });
    assert.equal(s4.pieces!.manquantes, 0, 'déjà dans le dossier des sauvegardes');
    await autre.insert('pieces', ligneDe('9'.repeat(32), 4));
    const s5 = sauvegarder(file, { date: jour(5), keep: 3 });
    assert.equal(s5.pieces!.manquantes, 1);
    // Restauration d'une copie : les fichiers qu'elle désigne reviennent dans le dossier des pièces.
    autre.sql.close();
    const r = restaurer(s3.fichier, file, { keep: 5 });
    assert.deepEqual(r.pieces, { designees: 1, restaurees: 1, manquantes: 0 });
    assert.deepEqual(readFileSync(join(base, 'pieces', f1)), PDF);
    assert.equal(statSync(join(base, 'pieces', f1)).mode & 0o777, 0o600);
    // Copie rapatriée ailleurs avec son dossier de pièces (copie externe) : prise à côté du fichier restauré.
    rmSync(join(base, 'pieces', f1));
    const ailleurs = join(base, 'rapatrie');
    rmSync(ailleurs, { recursive: true, force: true });
    const { cpSync } = await import('node:fs');
    cpSync(backups, ailleurs, { recursive: true });
    rmSync(miroir, { recursive: true });
    const r2 = restaurer(join(ailleurs, s3.fichier.split('/').at(-1)!), file, { keep: 5, dir: join(base, 'autres-copies') });
    assert.equal(r2.pieces!.restaurees, 1);
    rmSync(join(ailleurs, 'pieces-cursus'), { recursive: true });
    rmSync(join(base, 'pieces', f1));
    const r3 = restaurer(join(ailleurs, s3.fichier.split('/').at(-1)!), file, { keep: 5, dir: join(base, 'autres-copies') });
    assert.equal(r3.pieces!.manquantes, 1);
  } finally {
    try { autre.sql.close(); } catch { /* déjà fermée */ }
    rmSync(base, { recursive: true, force: true });
  }
});

test('migration lot6-pieces-index : index créés, notée faite ensuite', async () => {
  const m = new Db(':memory:');
  await m.exec('DROP INDEX IF EXISTS pieces_emp; DROP INDEX IF EXISTS pieces_objet');
  assert.ok(await INDEX_PIECES.necessaire!(m));
  assert.equal(await INDEX_PIECES.executer(m), 'index pieces_emp, pieces_objet');
  assert.ok(indexExiste(m, 'pieces_emp') && indexExiste(m, 'pieces_objet'));
  assert.ok(!(await INDEX_PIECES.necessaire!(m)));
  assert.ok(indexExiste(db, 'pieces_emp'), 'base du test : migration appliquée');
  // Base en mémoire : dossier temporaire propre à la base.
  assert.equal(pieces.dossierPiecesDe(m), pieces.dossierPiecesDe(m));
  m.sql.close();
});
