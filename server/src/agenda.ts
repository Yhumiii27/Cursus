// Agenda personnel (t036). Décision de l'entreprise : tous les salariés ont une adresse professionnelle Microsoft 365
// (Outlook). Deux voies :
// - les congés validés arrivent dans Outlook par le fichier .ics joint à l'e-mail de décision (journées entières, UID
//   stable `absence-<n°>` : l'annulation du congé envoie le même événement annulé) — `icsConge`, server/src/notifications.ts ;
// - un flux personnel par abonnement (`GET /api/agenda/<jeton>.ics`, hors session : le client d'agenda n'a pas de
//   cookie) : sessions de formation inscrites, entretiens planifiés, absences en vigueur et déplacements. Désactivé par
//   défaut (réglage `agendaFluxActif`, Paramètres → Agenda) ; absences toujours sous le libellé neutre « Absent », quelle
//   que soit leur nature, comme ce que voit le manager. Jeton long et aléatoire (256 bits), montré une seule fois au
//   salarié, stocké haché (SHA-256), révocable par lui (Portail) et en bloc par l'administrateur RH ; un jeton inconnu,
//   révoqué, d'un salarié sorti ou dont le compte est désactivé, ou un flux désactivé reçoivent la même réponse 404. Débit limité par adresse et par jeton.
import express, { type Request, type Response, type Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { ENT_TYPES } from '../../shared/constants.ts';
import { addD } from '../../shared/dates.ts';
import { sessionActive } from '../../shared/domain.ts';
import { present } from '../../shared/rules/contrats.ts';
import { completerSession, finSession, horaireDuJour, joursSession } from '../../shared/rules/plage-session.ts';
import type { Absence, ContenuAgenda, Destination, Employe, Entretien, ISODate, Session, Settings, Voyage } from '../../shared/types.ts';
import { loadSettings, todayIso } from './dataset.ts';
import { type Db, enSerie } from './db.ts';
import { LimiteurDebit, tropDeRequetes } from './debit.ts';
import { calendrier, domaineAgenda, type EvenementAgenda } from './integrations/email.ts';

/** Libellé d'un congé dans l'agenda (e-mail de décision) ; toute autre nature : « Absent ». */
const TITRE_CONGE: Record<string, string> = { CP: 'Congés payés', RTT: 'RTT / repos', RECUP: 'Récupération' };
export const TITRE_ABSENCE = 'Absent';

/** Événement d'une absence : journées entières, demi-journée précisée dans la description. */
function evenementAbsence(a: Pick<Absence, 'id' | 'type' | 'du' | 'au' | 'debutDemi' | 'finDemi'>, titre: string): EvenementAgenda {
  const demi = [a.debutDemi === 'apres_midi' ? 'après-midi le premier jour' : '', a.finDemi === 'matin' ? 'matin le dernier jour' : ''].filter(Boolean).join(', ');
  return { uid: `absence-${a.id}@${domaineAgenda()}`, date: a.du, fin: a.au, titre, ...(demi ? { description: `Demi-journée : ${demi}` } : {}) };
}

/** Fichier .ics d'un congé validé, ou de son annulation (même UID), joint à l'e-mail du salarié. */
export function icsConge(a: Pick<Absence, 'id' | 'type' | 'du' | 'au' | 'debutDemi' | 'finDemi'>, o: { annule?: boolean; organisateur?: EvenementAgenda['organisateur'] } = {}): string {
  return calendrier({ ...evenementAbsence(a, TITRE_CONGE[a.type] ?? TITRE_ABSENCE), annule: o.annule, organisateur: o.organisateur ?? null });
}

// — Jetons d'abonnement —

/** Jeton : 32 octets aléatoires en base64url (43 caractères). */
const FORME_JETON = /^[A-Za-z0-9_-]{43}$/;
export const empreinteJeton = (jeton: string) => createHash('sha256').update(jeton).digest('hex');

interface JetonAgenda { id: number; empId: number; empreinte: string; creeLe: string; revoqueLe: string | null; revoquePar: string | null; dernierAcces: string | null }

/** Jeton en vigueur d'un salarié (un seul à la fois). */
export async function jetonActif(db: Db, empId: number): Promise<JetonAgenda | undefined> {
  const r = await db.one<{ id: number }>('SELECT id FROM jetons_agenda WHERE emp_id = ? AND revoque_le IS NULL ORDER BY id DESC LIMIT 1', [empId]);
  return r ? await db.get<JetonAgenda>('jetonsAgenda', r.id) : undefined;
}

/** Révoque les jetons en vigueur d'un salarié (tous les salariés sans `empId`) ; renvoie leur nombre. */
export async function revoquerJetons(db: Db, par: string, empId?: number): Promise<number> {
  const r = empId == null
    ? await db.run('UPDATE jetons_agenda SET revoque_le = ?, revoque_par = ? WHERE revoque_le IS NULL', [new Date().toISOString(), par])
    : await db.run('UPDATE jetons_agenda SET revoque_le = ?, revoque_par = ? WHERE revoque_le IS NULL AND emp_id = ?', [new Date().toISOString(), par, empId]);
  return Number(r.changes);
}

/** Nouveau jeton (le précédent est révoqué) : la valeur n'est renvoyée qu'ici, seule son empreinte est gardée. */
export async function creerJeton(db: Db, empId: number, par: string): Promise<{ jeton: string; id: number }> {
  await revoquerJetons(db, par, empId);
  const jeton = randomBytes(32).toString('base64url');
  const l = await db.insert<JetonAgenda>('jetonsAgenda', { empId, empreinte: empreinteJeton(jeton), creeLe: new Date().toISOString() });
  return { jeton, id: l.id };
}

// — Flux —

/** Fenêtre publiée : 3 mois en arrière, un peu plus d'un an en avant. */
export const FENETRE_AGENDA = { avant: 92, apres: 400 };

/** Événement d'une session de formation : journées entières, ou un créneau par jour à l'heure de Paris. */
function evenementSession(s: Session, empId: number, nom: string): EvenementAgenda {
  const base = { uid: `formation-${s.id}-${empId}@${domaineAgenda()}`, titre: `Formation : ${nom}`, lieu: s.lieu, provisoire: s.statut === 'À confirmer' };
  if (!s.horaires?.length) return { ...base, date: s.date, fin: finSession(s) };
  return { ...base, date: s.date, creneaux: joursSession(s).map(jour => { const h = horaireDuJour(s, jour)!; return { jour, debut: h.debut, fin: h.fin }; }) };
}

/** Événements du flux d'un salarié, selon le contenu réglé. */
export async function evenementsAgenda(db: Db, empId: number, s: Pick<Settings, 'agendaContenu'>, ti: ISODate): Promise<EvenementAgenda[]> {
  const du = addD(ti, -FENETRE_AGENDA.avant), au = addD(ti, FENETRE_AGENDA.apres);
  const contenu = new Set<ContenuAgenda>(s.agendaContenu);
  const dans = (debut: ISODate, fin: ISODate) => fin >= du && debut <= au;
  const evs: EvenementAgenda[] = [];
  if (contenu.has('sessions')) {
    const formations = new Map((await db.all<{ id: string; nom: string }>('formations')).map(f => [f.id, f.nom]));
    const ids = (await db.query<{ s: number }>('SELECT session_id AS s FROM certifications WHERE emp_id = ? AND session_id IS NOT NULL AND annule_le IS NULL UNION SELECT session_id FROM inscriptions WHERE emp_id = ?',
      [empId, empId])).map(r => r.s);
    for (const id of new Set(ids)) {
      const x = await db.get<Omit<Session, 'inscrits'>>('sessions', id);
      if (!x) continue;
      const sess = completerSession(x) as Session;
      if (!sessionActive(sess) || !dans(sess.date, finSession(sess))) continue;
      evs.push(evenementSession(sess, empId, formations.get(sess.formation) ?? sess.formation));
    }
  }
  if (contenu.has('entretiens')) {
    for (const x of await db.where<Entretien>('entretiens', 'empId', empId)) {
      if (x.statut !== 'planifie' || !dans(x.date, x.date)) continue;
      evs.push({ uid: `entretien-${x.id}@${domaineAgenda()}`, date: x.date, titre: ENT_TYPES[x.type]?.nom ?? 'Entretien' });
    }
  }
  if (contenu.has('absences')) {
    // Absences en vigueur (validées, ou signalées à qualifier), toutes sous « Absent » : jamais leur nature.
    for (const a of await db.where<Absence>('absences', 'empId', empId)) {
      if ((a.statut !== 'validee' && a.statut !== 'signalee') || !dans(a.du, a.au)) continue;
      evs.push(evenementAbsence(a, TITRE_ABSENCE));
    }
  }
  if (contenu.has('deplacements')) {
    const pays = new Map((await db.all<Destination>('destinations')).map(d => [d.code, d.pays]));
    for (const v of await db.where<Voyage>('voyages', 'empId', empId)) {
      if (v.annuleLe || !dans(v.depart, v.retour)) continue;
      evs.push({ uid: `voyage-${v.id}@${domaineAgenda()}`, date: v.depart, fin: v.retour, titre: `Déplacement : ${pays.get(v.dest) ?? v.dest}` });
    }
  }
  return evs.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

/** Blocs d'un fichier .ics (VEVENT, VTIMEZONE), lignes repliées comprises. */
function blocs(ics: string, nom: string): string[][] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const l of ics.split('\r\n')) {
    if (l === `BEGIN:${nom}`) cur = [];
    if (cur) cur.push(l);
    if (l === `END:${nom}` && cur) { out.push(cur); cur = null; }
  }
  return out;
}

/**
 * Calendrier du flux : un VCALENDAR sans METHOD (abonnement), le fuseau de Paris une fois si un créneau l'utilise, chaque
 * événement produit par `calendrier` (RFC 5545, mêmes règles que les convocations). Actualisation proposée toutes les 6 h.
 */
export function calendrierFlux(evs: readonly EvenementAgenda[], maintenant = new Date()): string {
  const fichiers = evs.map(ev => calendrier(ev, maintenant));
  const fuseau = fichiers.map(f => blocs(f, 'VTIMEZONE')[0]).find(Boolean);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cursus//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Cursus',
    'X-PUBLISHED-TTL:PT6H', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    ...(fuseau ?? []),
    ...fichiers.flatMap(f => blocs(f, 'VEVENT').flat()),
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}

/** Limites du flux : les clients d'agenda relisent toutes les quelques heures ; une rafale vient d'un script. */
export const DEBIT_AGENDA = { ip: { capacite: 60, parMinute: 20 }, jeton: { capacite: 10, parMinute: 2 } } as const;

/** Route publique du flux (hors session et hors CSRF : un GET qui ne modifie rien d'autre que la date du dernier accès). */
export function routesAgenda(db: Db, limites = { ip: new LimiteurDebit(DEBIT_AGENDA.ip), jeton: new LimiteurDebit(DEBIT_AGENDA.jeton) }): Router {
  const r = express.Router();
  // Lecture du jeton, de la fiche et du flux, et note du dernier accès d'un seul tenant sur la base (`enSerie`).
  r.get('/api/agenda/:fichier', enSerie(db, async (req: Request, res: Response) => {
    const attente = limites.ip.prendre(req.ip ?? '');
    if (attente) return tropDeRequetes(req, res, attente, 'Trop de lectures de l’agenda depuis ce poste');
    const introuvable = () => res.status(404).type('text/plain; charset=utf-8').send('Agenda introuvable');
    const fichier = String(req.params.fichier);
    const jeton = fichier.endsWith('.ics') ? fichier.slice(0, -4) : '';
    if (!FORME_JETON.test(jeton)) return introuvable();
    const s = await loadSettings(db);
    if (!s.agendaFluxActif) return introuvable();
    const empreinte = empreinteJeton(jeton);
    const attenteJeton = limites.jeton.prendre(empreinte);
    if (attenteJeton) return tropDeRequetes(req, res, attenteJeton, 'Agenda relu trop souvent');
    const j = await db.one<{ id: number; empId: number; dernierAcces: string | null }>('SELECT id, emp_id AS "empId", dernier_acces AS "dernierAcces" FROM jetons_agenda WHERE empreinte = ? AND revoque_le IS NULL', [empreinte]);
    const e = j ? await db.get<Employe>('employes', j.empId) : undefined;
    const ti = todayIso();
    // Salarié parti, ou compte de connexion désactivé : l'abonnement ne vaut plus.
    const compte = j && await db.one('SELECT 1 FROM comptes WHERE emp_id = ? AND actif = TRUE', [j.empId]);
    if (!j || !e || !compte || !present(e, ti) || e.anonymiseLe) return introuvable();
    // Dernier accès noté au plus une fois par heure (le client d'agenda relit souvent).
    const maintenant = new Date();
    if (!j.dernierAcces || maintenant.getTime() - Date.parse(j.dernierAcces) > 3600_000) await db.update('jetonsAgenda', j.id, { dernierAcces: maintenant.toISOString() });
    res.set('Content-Disposition', 'inline; filename="cursus.ics"');
    res.type('text/calendar; charset=utf-8').send(calendrierFlux(await evenementsAgenda(db, e.id, s, ti), maintenant));
  }));
  return r;
}
