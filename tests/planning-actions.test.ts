// Planning d'équipe (lot 12, chantier C5, étape 1) : actions sur le jeu de démonstration (Karim Haddad, 12, encadre la
// Maintenance : Mehdi Benali, 2, dont l'habilitation électrique est expirée, et Thomas Garnier, 6), le 10 octobre 2026 à
// 9 h : module désactivé, affectation, génération, publication versionnée (délai de prévenance compté depuis l'e-mail,
// motif exigé et jamais journalisé, alertes à motiver, refus d'une habilitation, semaine validée), modification et
// annulation d'un créneau publié, échanges (proposition, acceptation, validation, expiration), délégation « planning »,
// vues par espace et par profil, historique à la demande, cache incrémental (banc d'oracle), migration et références.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CURSUS_TODAY = '2026-10-10';

const { json, nouvelleBase, PG, SQLITE_SEUL, sqlite } = await import('./base.ts');
const { seedDemo, comptesDemo } = await import('../server/src/seed.ts');
const { buildSnapshot, currentUser, loadFull } = await import('../server/src/dataset.ts');
const { ACTIONS } = await import('../server/src/actions/index.ts');
const { ActionError, makeCtx } = await import('../server/src/actions/context.ts');
const { journaliserAction, preparerTrace } = await import('../server/src/journal.ts');
const { horloge } = await import('../server/src/astreintes.ts');
const { appliquerMigrations } = await import('../server/src/migrations/cadre.ts');
const { PLANNING_EQUIPE } = await import('../server/src/migrations/lot12-planning.ts');
const { controlerOrphelins } = await import('../server/src/integrite.ts');
const { controleDelegation, perimetreEffectif } = await import('../shared/rules/delegations-manager.ts');
const { creneauxPourSalarie } = await import('../server/src/vues-planning.ts');
const { ouvrirBanc, rejouer, resumeRapport } = await import('./support/oracle.ts');
const { CHAMPS_PAR_SALARIE } = await import('../server/src/vues-cache.ts');
const { FENETRES, LECTURES } = await import('../server/src/lecture-brute.ts');
const { familleAction, JOURNAL_LABEL } = await import('../shared/journal.ts');
type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Creneau = import('../shared/types-planning.ts').Creneau;
type EchangePoste = import('../shared/types-planning.ts').EchangePoste;
interface Courriel { a: string[]; objet: string; texte: string }

horloge.maintenant = () => new Date('2026-10-10T09:00:00+02:00');

async function fresh(actif = true) {
  const db = await nouvelleBase();
  await seedDemo(db);
  if (actif) await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningActif: true });
  const compteId = async (empId: number | null) => (await db.one(empId ? 'SELECT id FROM comptes WHERE emp_id = ?' : 'SELECT id FROM comptes WHERE emp_id IS NULL', (empId ? [empId] : [])) as { id: number }).id;
  const user = async (empId: number | null, role: User['role']) => (await currentUser(db, { compteId: await compteId(empId), role, methode: 'demo' }))!;
  const run = async (u: User, name: string, p: Record<string, unknown>) => await db.tx(async () => {
    const t = await preparerTrace(db, name, p);
    const ctx = makeCtx(db, u, await loadFull(db, u));
    const r = await ACTIONS[name](ctx, p);
    const o: { message?: string | null; result?: unknown } = typeof r === 'object' && r !== null ? r as { message?: string; result?: unknown } : { message: r as string | null };
    await journaliserAction(db, t, { user: u, compte: (await db.get('comptes', u.compteId))!, message: o.message ?? null, result: o.result ?? null });
    return o;
  });
  const refuse = async (u: User, name: string, p: Record<string, unknown>, motif: RegExp, status?: number) =>
    await assert.rejects(async () => await run(u, name, p), (e: unknown) => e instanceof ActionError && motif.test(e.message) && (!status || e.status === status), `${name} : ${motif}`);
  const mails = async (type: string) => (await db.all<{ cible: string; type: string; contenu: unknown }>('envois'))
    .filter(e => e.cible === 'email' && e.type === type).map(e => json<Courriel>(e.contenu));
  const journal = async (action: string) => (await db.all<{ action: string; payload: unknown; salaries: unknown; message: string }>('journal')).filter(j => j.action === action)
    .map(j => ({ payload: json<Record<string, unknown>>(j.payload), salaries: json<number[]>(j.salaries), message: j.message }));
  const creneaux = async (empId?: number) => (await db.all<Creneau>('creneaux')).filter(c => empId === undefined || c.empId === empId);
  const RH = await user(null, 'rh'), KARIM = await user(12, 'manager'), MEHDI = await user(2, 'collaborateur'), THOMAS = await user(6, 'collaborateur');
  const HUGO = await user(16, 'manager');
  return { db, user, run, refuse, mails, journal, creneaux, RH, KARIM, MEHDI, THOMAS, HUGO };
}

/** Créneau publié écrit directement (date communiquée le 1er octobre). */
const publie = async (db: Awaited<ReturnType<typeof nouvelleBase>>, empId: number, jour: string, horaire: string | null = 'J', debut = '08:00', fin = '16:00') =>
  (await db.insert<Creneau>('creneaux', {
    empId, jour, equipe: 'Maintenance', horaire, debut: horaire ? debut : null, fin: horaire ? fin : null, pause: horaire ? 60 : 0, source: 'manuel', statut: 'publie', version: 1,
    publieLe: '2026-10-01T08:00:00.000Z', publiePar: 'Karim Haddad', communiqueLe: '2026-10-01', horsDelai: false, creeLe: '2026-10-01T08:00:00.000Z', creePar: 'Karim Haddad',
  })).id;

test('module désactivé : planning refusé (409), référentiels des cycles préparés ; délégation « planning » fermée', async () => {
  const { run, refuse, RH, KARIM, db } = await fresh(false);
  await refuse(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' }, /Planning d’équipe désactivé/, 409);
  await refuse(RH, 'planning.roulement.affecter', { empId: 6, cycle: 'JOUR', groupe: 'A', du: '2026-10-12' }, /désactivé/, 409);
  const o = await run(RH, 'planning.cycle.creer', { code: '4x8', nom: '4x8 d’essai', sequence: ['M', 'M', 'AM', 'AM', 'N', 'N', '', ''], groupes: [{ code: 'A', decalage: 0 }, { code: 'B', decalage: 2 }] });
  assert.equal(o.message, 'Cycle 4X8 créé (8 jours, 2 groupes)');
  const ds = await loadFull(db, RH);
  assert.deepEqual(perimetreEffectif(ds.settings, { perimetre: ['planning', 'feuilles'] }), ['feuilles']);
  // Instantané : rien du planning hors du service RH tant que le module est désactivé.
  assert.deepEqual((await buildSnapshot(db, KARIM)).cycles, []);
  assert.equal((await buildSnapshot(db, RH)).cycles!.length, 5);
});

test('affectation, génération et publication : délai de prévenance depuis l’e-mail, motif gardé et jamais journalisé ; versions', async () => {
  const { run, refuse, mails, journal, creneaux, RH, KARIM, THOMAS, db } = await fresh();
  // Affectation par le planificateur : jamais deux qui se chevauchent.
  const a = await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: 'jour', groupe: 'a', du: '2026-10-12' });
  assert.equal(a.message, 'Thomas Garnier affecté au cycle JOUR (groupe A) à partir du 12 oct. 2026');
  await refuse(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: '2X8', groupe: 'A', du: '2026-11-02' }, /Déjà affecté au cycle JOUR/);
  await refuse(THOMAS, 'planning.roulement.affecter', { empId: 6, cycle: '2X8', groupe: 'A', du: '2027-01-04' }, /manager du salarié/, 403);
  assert.deepEqual((await journal('planning.roulement.affecter'))[0], { payload: { id: 1, cycle: 'JOUR', groupe: 'A', du: '2026-10-12', au: null }, salaries: [6], message: a.message });
  // Génération : quatre semaines, du lundi au vendredi en journée, le week-end en repos ; rejouée, rien ne change.
  const g = await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-11-08' });
  assert.match(g.message!, /^Planning de l’équipe Maintenance généré du 12 oct\. 2026 au 8 nov\. 2026 : 28 créneaux créés, 0 mis à jour \(brouillon, à publier\)$/);
  assert.equal((await creneaux(6)).filter(c => c.horaire === 'J').length, 20);
  assert.match((await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-11-08' })).message!, /0 créneau créé, 0 mis à jour/);
  assert.deepEqual((await journal('planning.generer'))[0].payload, { equipe: 'Maintenance', du: '2026-10-12', au: '2026-11-08', crees: 28, maj: 0, gardes: 0 });
  await refuse(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2027-01-31' }, /12 semaines/);
  await refuse(await (await fresh()).user(16, 'manager'), 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' }, /tenu par son manager/, 403);
  // Publication de la première semaine : moins de 7 jours avant, le motif des circonstances exceptionnelles est exigé.
  await refuse(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' }, /5 créneaux communiqués moins de 7 jours avant leur date \(dès le 12 oct\. 2026\) : indiquez les circonstances exceptionnelles/);
  const motif = 'Arrêt de ligne imprévu : réorganisation de l’atelier';
  // Thomas : aptitude médicale à vérifier (réserve neutre de la démonstration), alerte à motiver.
  await refuse(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18', motif }, /^Publication : alertes à motiver — Thomas Garnier — Aptitude médicale à vérifier avec le service RH$/);
  const motifAlertes = 'Visite médicale programmée le mois prochain';
  const p = await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18', motif, motifAlertes });
  assert.match(p.message!, /^Planning de l’équipe Maintenance publié du 12 oct\. 2026 au 18 oct\. 2026 \(version 1\) : 7 créneaux dont 5 hors du délai de prévenance \(motif noté\) · 1 alerte acceptée · 1 salarié prévenu par e-mail$/);
  const semaine1 = (await creneaux(6)).filter(c => c.jour <= '2026-10-18');
  assert.ok(semaine1.every(c => c.statut === 'publie' && c.version === 1 && c.communiqueLe === '2026-10-10' && c.publiePar === 'Karim Haddad'));
  assert.deepEqual(semaine1.map(c => c.horsDelai), [true, true, true, true, true, false, false], 'samedi et dimanche : 7 et 8 jours avant');
  assert.ok(semaine1.every(c => (c.horsDelai ? c.motif === motif : c.motif === null) && c.motifAlertes === motifAlertes));
  assert.deepEqual(semaine1[0].alertesAcceptees, ['aptitude'], 'réserve gardée sur le créneau, pour le planificateur');
  const [mail] = await mails('planning.publie');
  assert.equal(mail.objet, 'Votre planning du 12 oct. 2026 au 18 oct. 2026');
  assert.match(mail.texte, /- lun\. 12 oct\. : J \(8 h – 16 h\)\n[\s\S]*- sam\. 17 oct\. : repos/);
  assert.match(mail.texte, /circonstances exceptionnelles : Arrêt de ligne imprévu/);
  const [jp] = await journal('planning.publier');
  assert.deepEqual(jp.payload, { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18', version: 1, creneaux: 7, horsDelai: 5, alertes: 1 });
  assert.doesNotMatch(JSON.stringify(await db.all('journal')), /Arrêt de ligne|Visite médicale|aptitude/i, 'ni motif ni code d’alerte au journal');
  assert.deepEqual(jp.salaries, [6]);
  // Semaine suivante : dans le délai, sans motif ; version 2. Republier : rien à publier.
  assert.match((await run(RH, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes })).message!, /version 2\) : 7 créneaux · 1 alerte acceptée · 1 salarié prévenu/);
  assert.equal((await run(RH, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25' })).message, 'Rien à publier sur cette période : aucun brouillon');
  assert.deepEqual((await db.all<{ version: number; creneaux: number; horsDelai: number }>('publicationsPlanning')).map(x => [x.version, x.creneaux, x.horsDelai]), [[1, 7, 5], [2, 7, 0]]);
  // Modification d'un créneau publié : nouvelle version en brouillon, qui remplace l'ancienne à la publication.
  const mardi = (await creneaux(6)).find(c => c.jour === '2026-10-20')!;
  const m = await run(KARIM, 'planning.creneau.modifier', { id: mardi.id, horaire: 'M' });
  assert.match(m.message!, /Créneau publié du 20 oct\. 2026 \(Thomas Garnier\) modifié : la nouvelle version est à publier/);
  // Le salarié voit toujours la version publiée ; le manager, la modification en attente.
  const vueThomas = (await buildSnapshot(db, THOMAS)).creneaux!.filter(c => c.jour === '2026-10-20');
  assert.deepEqual(vueThomas.map(c => [c.horaire, c.statut]), [['J', 'publie']]);
  assert.deepEqual((await buildSnapshot(db, KARIM)).creneaux!.filter(c => c.jour === '2026-10-20').map(c => [c.horaire, c.statut]).sort(), [['J', 'publie'], ['M', 'brouillon']]);
  assert.match((await run(KARIM, 'planning.creneau.modifier', { id: mardi.id, horaire: 'J' })).message!, /Modification du 20 oct\. 2026 \(Thomas Garnier\) retirée/);
  await run(KARIM, 'planning.creneau.modifier', { id: mardi.id, horaire: 'M' });
  await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-19', au: '2026-10-25', motifAlertes });
  const [ancien, nouveau] = (await creneaux(6)).filter(c => c.jour === '2026-10-20').sort((x, y) => x.id - y.id);
  assert.deepEqual([ancien.statut, nouveau.statut, nouveau.remplaceId, nouveau.version, nouveau.horaire], ['remplace', 'publie', ancien.id, 3, 'M']);
  assert.equal((await mails('planning.modifie'))[0].objet, 'Planning modifié du 20 oct. 2026');
  // Jour passé : il se corrige sur la feuille de temps.
  const passe = await publie(db, 6, '2026-10-09');
  await refuse(KARIM, 'planning.creneau.modifier', { id: passe, horaire: 'M' }, /Jour passé/, 409);
});

test('publication : alertes à motiver (codes gardés sur le créneau, jamais au journal), habilitation refusée, semaine validée verrouillée', async () => {
  const { run, refuse, journal, creneaux, RH, KARIM, db } = await fresh();
  await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: 'JOUR', groupe: 'A', du: '2026-10-26' });
  await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-26', au: '2026-11-15' });
  // Dimanche travaillé sans dérogation de l'équipe : alerte, motif exigé.
  const dimanche = (await creneaux(6)).find(c => c.jour === '2026-11-01')!;
  await run(KARIM, 'planning.creneau.modifier', { id: dimanche.id, horaire: 'J' });
  await refuse(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-26', au: '2026-11-01' }, /Publication : alertes à motiver — Thomas Garnier — 1 nov\. 2026 : travail le dimanche sans dérogation/);
  const o = await run(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-10-26', au: '2026-11-01', motifAlertes: 'Inventaire annuel' });
  assert.match(o.message!, /· 2 alertes acceptées ·/, 'dimanche, et la réserve d’aptitude de Thomas');
  const d = (await creneaux(6)).find(c => c.jour === '2026-11-01' && c.statut === 'publie')!;
  assert.deepEqual([d.alertesAcceptees, d.motifAlertes], [['dimanche', 'aptitude'], 'Inventaire annuel']);
  assert.deepEqual((await creneaux(6)).find(c => c.jour === '2026-10-30')!.alertesAcceptees, ['aptitude'], 'les autres jours : la réserve seule');
  const [j] = await journal('planning.publier');
  assert.equal(j.payload.alertes, 2);
  assert.doesNotMatch(JSON.stringify(j), /dimanche|Inventaire|aptitude/);
  // Mehdi : habilitation électrique exigée, expirée le 1er octobre → refus, sans motif possible.
  await run(KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2026-11-03', horaire: 'J', empId: 2 });
  await refuse(KARIM, 'planning.publier', { equipe: 'Maintenance', du: '2026-11-02', au: '2026-11-08', motifAlertes: 'Sans objet' }, /Publication impossible : Mehdi Benali — 3 nov\. 2026 : habilitation exigée Habilitation électrique expirée le 1 oct\. 2026/, 409);
  await run(KARIM, 'planning.creneau.annuler', { id: (await creneaux(2))[0].id });
  assert.equal((await creneaux(2)).length, 0, 'brouillon retiré');
  // Feuille de la semaine déjà validée : jamais publiée.
  await db.insert('feuilles', { empId: 6, week: '2026-11-09', statut: 'validee', comment: null, sage: false, keystone: false, lignes: [] });
  await refuse(RH, 'planning.publier', { equipe: 'Maintenance', du: '2026-11-09', au: '2026-11-15' }, /Feuille de temps déjà validée : Thomas Garnier \(semaine du 9 nov\. 2026\)/, 409);
  // Nuit d'un mineur et hors contrat : refusés dès la saisie.
  await refuse(KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2027-09-01', horaire: 'J', empId: 24 }, /hors du contrat/);
});

test('annulation d’un créneau publié : motif exigé, communiqué au salarié, jamais journalisé ; échanges ouverts annulés', async () => {
  const { run, refuse, mails, journal, db, KARIM, THOMAS } = await fresh();
  const id = await publie(db, 6, '2026-10-22');
  const e = await db.insert<EchangePoste>('echangesPoste', { demandeurId: 6, partenaireId: 2, creneauDemandeur: id, creneauPartenaire: null, statut: 'propose', creeLe: '2026-10-05T08:00:00.000Z' });
  await refuse(KARIM, 'planning.creneau.annuler', { id }, /Indiquez le motif/);
  await refuse(THOMAS, 'planning.creneau.annuler', { id, motif: 'x' }, /manager du salarié/, 403);
  const o = await run(KARIM, 'planning.creneau.annuler', { id, motif: 'Panne du four : atelier fermé' });
  assert.equal(o.message, 'Poste du 22 oct. 2026 (Thomas Garnier) annulé · e-mail envoyé au salarié');
  assert.match((await mails('planning.annule'))[0].texte, /Motif : Panne du four/);
  assert.equal((await db.get<EchangePoste>('echangesPoste', e.id))!.statut, 'annule');
  assert.deepEqual((await journal('planning.creneau.annuler'))[0].payload, { id, jour: '2026-10-22', horaire: 'J', statut: 'annule' });
  assert.doesNotMatch(JSON.stringify(await db.all('journal')), /Panne du four/);
});

test('échanges : le salarié propose, le collègue accepte, le manager valide ; contrôles des deux ; expiration', async () => {
  const { run, refuse, mails, journal, creneaux, db, KARIM, MEHDI, THOMAS, RH } = await fresh();
  // Thomas cède son poste du samedi 7 novembre à Mehdi ? Mehdi n'a pas d'habilitation électrique valide : refus à la validation.
  const samedi = await publie(db, 6, '2026-11-07');
  await refuse(MEHDI, 'planning.echange.proposer', { creneauId: samedi, partenaireId: 6 }, /salarié lui-même/, 403);
  await refuse(THOMAS, 'planning.echange.proposer', { creneauId: samedi, partenaireId: 16 }, /même équipe/);
  const p = await run(THOMAS, 'planning.echange.proposer', { creneauId: samedi, partenaireId: 2 });
  const id = (p.result as { echange: number }).echange;
  assert.equal(p.message, 'Échange proposé à Mehdi Benali : il doit l’accepter, puis votre manager le valider');
  assert.equal((await mails('planning.echange.demande'))[0].objet, 'Échange de poste proposé par Thomas Garnier');
  await refuse(THOMAS, 'planning.echange.proposer', { creneauId: samedi, partenaireId: 2 }, /déjà en cours/, 409);
  await refuse(THOMAS, 'planning.echange.accepter', { id }, /collègue sollicité/, 403);
  await refuse(KARIM, 'planning.echange.valider', { id }, /pas encore accepté/, 409);
  await run(MEHDI, 'planning.echange.accepter', { id });
  await refuse(MEHDI, 'planning.echange.valider', { id }, /manager des deux salariés/, 403);
  await refuse(KARIM, 'planning.echange.valider', { id }, /Validation de l’échange impossible : Mehdi Benali — 7 nov\. 2026 : habilitation exigée Habilitation électrique/, 409);
  await run(KARIM, 'planning.echange.refuser', { id, motif: 'Habilitation à renouveler' });
  assert.equal((await db.get<EchangePoste>('echangesPoste', id))!.motifRefus, 'Habilitation à renouveler');
  assert.doesNotMatch(JSON.stringify(await journal('planning.echange.refuser')), /renouveler/);
  // Dans l'autre sens : Mehdi cède son samedi 7 novembre à Thomas (repos ce jour-là) ; validé par le service RH.
  const sien = await publie(db, 2, '2026-11-07', 'J');
  await db.update('creneaux', samedi, { horaire: null, debut: null, fin: null, pause: 0 });
  const p2 = await run(MEHDI, 'planning.echange.proposer', { creneauId: sien, partenaireId: 6 });
  const id2 = (p2.result as { echange: number }).echange;
  await run(THOMAS, 'planning.echange.accepter', { id: id2 });
  await refuse(RH, 'planning.echange.valider', { id: id2 }, /^Validation de l’échange : alertes à motiver — Thomas Garnier — Aptitude médicale à vérifier/);
  const v = await run(RH, 'planning.echange.valider', { id: id2, motifAlertes: 'Visite médicale programmée' });
  assert.equal(v.message, 'Échange entre Mehdi Benali et Thomas Garnier validé : planning mis à jour · 1 alerte acceptée');
  const jour7 = (await creneaux()).filter(c => c.jour === '2026-11-07').map(c => `${c.empId} ${c.horaire ?? 'repos'} ${c.statut} ${c.source}`).sort();
  assert.deepEqual(jour7, ['2 J remplace manuel', '2 repos publie echange', '6 J publie echange', '6 repos remplace manuel']);
  assert.deepEqual((await journal('planning.echange.valider'))[0], { payload: { id: id2, echange: id2, statut: 'valide', alertes: 1 }, salaries: [2, 6], message: v.message });
  assert.deepEqual((await db.get<EchangePoste>('echangesPoste', id2))!.alertesAcceptees, ['aptitude']);
  // Acceptation au demandeur (deux fois), refus et validation aux deux salariés.
  assert.equal((await mails('planning.echange.decision')).length, 6);
  assert.deepEqual((await mails('planning.echange.demande')).map(m => m.objet), ['Échange de poste proposé par Thomas Garnier', 'Échange de poste proposé par Mehdi Benali']);
  // Karim (récapitulatif quotidien dans la démonstration) : les échanges à valider attendent son récapitulatif.
  assert.deepEqual((await db.all<{ empId: number; type: string; objet: string }>('notifications')).filter(n => n.type === 'planning.echange.demande').map(n => [n.empId, n.objet]),
    [[12, 'Échange de poste à valider — Thomas Garnier et Mehdi Benali'], [12, 'Échange de poste à valider — Mehdi Benali et Thomas Garnier']]);
  // Retrait par le demandeur seulement ; expiration au début du créneau.
  const lundi = await publie(db, 6, '2026-10-12');
  const p3 = await run(THOMAS, 'planning.echange.proposer', { creneauId: lundi, partenaireId: 2 });
  await refuse(MEHDI, 'planning.echange.annuler', { id: (p3.result as { echange: number }).echange }, /proposé l’échange/, 403);
  assert.equal((await run(THOMAS, 'planning.echange.annuler', { id: (p3.result as { echange: number }).echange })).message, 'Échange retiré');
  const ce = await publie(db, 6, '2026-10-10'); // aujourd'hui 8 h : commencé à 9 h
  await refuse(THOMAS, 'planning.echange.proposer', { creneauId: ce, partenaireId: 2 }, /commencé ou passé/, 409);
  const ouvert = await db.insert<EchangePoste>('echangesPoste', { demandeurId: 6, partenaireId: 2, creneauDemandeur: ce, creneauPartenaire: null, statut: 'propose', creeLe: '2026-10-09T08:00:00.000Z' });
  assert.equal((await run(MEHDI, 'planning.echange.accepter', { id: ouvert.id })).message, 'Échange expiré : un des postes a commencé');
  assert.equal((await db.get<EchangePoste>('echangesPoste', ouvert.id))!.statut, 'expire');
});

test('délégation « planning » : ouverte avec le module ; le suppléant planifie l’équipe, signé par délégation', async () => {
  const { run, refuse, journal, db, HUGO } = await fresh();
  const ds = await loadFull(db, HUGO);
  const noms = { suppleant: ds.employes.find(e => e.id === 16), nom: (id: number) => `n° ${id}` };
  assert.equal(controleDelegation(ds, { managerId: 12, suppleantId: 16, du: '2026-10-10', au: '2026-10-20', perimetre: ['planning'] }, noms), null);
  await refuse(HUGO, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' }, /tenu par son manager/, 403);
  await db.insert('delegations', { managerId: 12, suppleantId: 16, du: '2026-10-10', au: '2026-10-20', perimetre: ['planning'], creeLe: '2026-10-09T08:00:00.000Z', creePar: 'Karim Haddad' });
  await run(HUGO, 'planning.roulement.affecter', { empId: 6, cycle: 'JOUR', groupe: 'A', du: '2026-10-12' });
  const g = await run(HUGO, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-10-18' });
  assert.match(g.message!, /7 créneaux créés/);
  assert.equal((await journal('planning.generer')).length, 1);
});

test('vues : le collaborateur ses créneaux publiés (sans alertes), ses collègues seulement par réglage ; profils sans motifs', async () => {
  const { db, RH, KARIM, MEHDI, THOMAS, user } = await fresh();
  const pub = await publie(db, 6, '2026-10-21');
  await db.update('creneaux', pub, { alertesAcceptees: ['aptitude'], motifAlertes: 'Visite programmée', motif: 'Panne' });
  await publie(db, 6, '2026-10-22', null);
  await db.insert('creneaux', { empId: 6, jour: '2026-10-23', equipe: 'Maintenance', horaire: 'J', debut: '08:00', fin: '16:00', pause: 60, source: 'cycle', statut: 'brouillon', creeLe: '2026-10-01', creePar: 'x' });
  await db.insert('creneaux', { empId: null, jour: '2026-10-23', equipe: 'Maintenance', horaire: 'N', debut: '21:00', fin: '05:00', pause: 30, source: 'manuel', statut: 'brouillon', creeLe: '2026-10-01', creePar: 'x' });
  const t = await buildSnapshot(db, THOMAS);
  assert.deepEqual(t.creneaux!.map(c => [c.jour, c.statut, c.motif, c.alertesAcceptees, c.motifAlertes]), [['2026-10-21', 'publie', 'Panne', null, null], ['2026-10-22', 'publie', null, null, null]]);
  assert.deepEqual(t.creneauxAPourvoir, []);
  assert.deepEqual((await buildSnapshot(db, MEHDI)).creneaux, [], 'collègues fermés par défaut');
  const k = await buildSnapshot(db, KARIM);
  assert.equal(k.creneaux!.length, 3);
  assert.deepEqual(k.creneaux!.find(c => c.id === pub)!.alertesAcceptees, ['aptitude'], 'le planificateur voit la réserve');
  assert.equal(k.creneauxAPourvoir!.length, 1);
  for (const [empId, profil] of [[23, 'referent_hse'], [7, 'paie'], [11, 'lecture_seule']] as const) {
    const u = await user(empId, 'rh');
    assert.equal(u.profilRh, profil);
    const v = await buildSnapshot(db, u);
    assert.ok(v.creneaux!.length > 0, profil);
    assert.ok(v.creneaux!.every(c => !c.motif && !c.alertesAcceptees && !c.motifAlertes), `${profil} : sans motifs ni alertes`);
  }
  assert.equal((await buildSnapshot(db, RH)).creneaux!.find(c => c.id === pub)!.motifAlertes, 'Visite programmée');
  // Réglage ouvert : les postes publiés des collègues, sans repos ni motif ; jamais une absence.
  await db.setSetting('app', { ...await db.getSetting<Record<string, unknown>>('app', {}), planningCollegues: true });
  const m = await buildSnapshot(db, MEHDI);
  assert.deepEqual(m.creneaux!.map(c => [c.empId, c.jour, c.horaire, c.motif, c.publiePar]), [[6, '2026-10-21', 'J', null, null]]);
  // Consultation N+2 : sans motifs (règle de filtrage, sans planification).
  const [n2] = creneauxPourSalarie([{ ...(await db.get<Creneau>('creneaux', pub))!, alertesAcceptees: ['aptitude'] }], { user: KARIM, ids: new Set([6]), planifies: new Set(), collegues: new Set() });
  assert.deepEqual([n2.alertesAcceptees, n2.motif, n2.motifAlertes], [null, null, null]);
});

test('historique à la demande : hors de la fenêtre de l’instantané, filtré par droits ; un an au plus', async () => {
  const { db } = await fresh();
  await db.tx(async () => await comptesDemo(db));
  const ancien = await publie(db, 6, '2026-03-02');
  await db.update('creneaux', ancien, { motif: 'Ancien motif' });
  await publie(db, 2, '2026-03-02');
  assert.ok(!(await loadFull(db, (await currentUser(db, { compteId: 1, role: 'rh', methode: 'demo' }))!)).creneaux!.some(c => c.id === ancien), 'hors de la fenêtre de 8 semaines');
  const banc = await ouvrirBanc(db);
  try {
    const compteDe = async (empId: number) => ((await db.one('SELECT id FROM comptes WHERE emp_id = ?', [empId])) as { id: number }).id;
    const lire = async (compteId: number, role: string, q: string) => {
      const a = banc.acteurs.find(x => x.compteId === compteId && x.role === role)!;
      const r = await fetch(`${banc.base}/api/planning/historique?${q}`, { headers: { cookie: a.cookie, 'x-cursus-espace': role } });
      return { status: r.status, corps: await r.json() as { creneaux?: Creneau[]; error?: string } };
    };
    const thomas = await lire(await compteDe(6), 'collaborateur', 'du=2026-03-01&au=2026-03-31');
    assert.deepEqual(thomas.corps.creneaux!.map(c => [c.empId, c.motif]), [[6, 'Ancien motif']]);
    const karim = await lire(await compteDe(12), 'manager', 'du=2026-03-01&au=2026-03-31');
    assert.deepEqual(karim.corps.creneaux!.map(c => c.empId).sort(), [2, 6]);
    const hse = await lire(await compteDe(23), 'rh', 'du=2026-03-01&au=2026-03-31');
    assert.ok(hse.corps.creneaux!.every(c => !c.motif));
    assert.equal((await lire(await compteDe(6), 'collaborateur', 'du=2026-01-01&au=2027-03-31')).status, 400);
    assert.equal((await lire(await compteDe(6), 'collaborateur', 'du=2026-03-31&au=2026-03-01')).status, 400);
  } finally {
    banc.fermer();
  }
});

test('cache incrémental : tables et fenêtre déclarées ; banc d’oracle avec les actions du planning en renfort', async () => {
  assert.ok(CHAMPS_PAR_SALARIE.has('creneaux') && CHAMPS_PAR_SALARIE.has('roulements'));
  assert.ok(!CHAMPS_PAR_SALARIE.has('creneauxAPourvoir') && !CHAMPS_PAR_SALARIE.has('echangesPoste'), 'à pourvoir et échanges : champs communs');
  assert.deepEqual(LECTURES.creneauxAPourvoir, ['creneaux']);
  assert.deepEqual(FENETRES.creneaux!('2026-10-10').params, ['2026-08-15', '2027-01-02']);
  const { db, run, KARIM } = await fresh();
  await db.tx(async () => await comptesDemo(db));
  await run(KARIM, 'planning.roulement.affecter', { empId: 6, cycle: 'JOUR', groupe: 'A', du: '2026-10-12' });
  await run(KARIM, 'planning.generer', { equipe: 'Maintenance', du: '2026-10-12', au: '2026-11-22' });
  await run(KARIM, 'planning.creneau.ajouter', { equipe: 'Maintenance', jour: '2026-10-20', horaire: 'N' });
  const renfort = ['planning.generer', 'planning.creneau.modifier', 'planning.creneau.modifier', 'planning.creneau.ajouter', 'planning.publier', 'planning.publier',
    'planning.creneau.annuler', 'planning.echange.proposer', 'planning.echange.accepter', 'planning.roulement.affecter'].flatMap(a => Array<string>(10).fill(a));
  const x = await rejouer(db, { graine: 20261101, pas: 90, verifierTous: 3, jeux: 0, sql: 0.1, renfort });
  assert.deepEqual(x.erreurs, [], resumeRapport(x));
  assert.deepEqual(x.divergences, [], resumeRapport(x));
  assert.ok(Object.entries(x.actions).some(([a, s]) => a.startsWith('planning.') && s.ok > 0), `${resumeRapport(x)}\n${JSON.stringify(x.actions)}\n${JSON.stringify(x.motifs)}`);
});

test('journal : libellés et famille « temps » ; migration nommée et références sans orphelin', { skip: PG && SQLITE_SEUL }, async () => {
  for (const a of Object.keys(ACTIONS).filter(n => n.startsWith('planning.'))) {
    assert.ok(JOURNAL_LABEL[a], a);
    assert.equal(familleAction(a)?.id, 'temps', a);
  }
  const { db } = await fresh();
  assert.equal((await controlerOrphelins(db)).orphelins, 0);
  const s = sqlite(db);
  s.sql.exec('DROP INDEX IF EXISTS creneaux_emp_jour');
  assert.equal(await PLANNING_EQUIPE.necessaire!(s), true);
  assert.match(String(await PLANNING_EQUIPE.executer(s)), /^index creneaux_emp_jour, creneaux_equipe_jour/);
  assert.equal(await PLANNING_EQUIPE.necessaire!(s), false);
  void appliquerMigrations;
});
