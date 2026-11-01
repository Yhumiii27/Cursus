// Historique des notes de frais (lot 12, chantier C2, étape 1) : les notes payées depuis plus de 13 mois sortent de
// l'instantané (`FENETRES`, server/src/lecture-brute.ts) et se lisent à la demande, en base, par deux routes :
//   GET /api/frais/historique             empId, du, au (AAAA-MM ou AAAA-MM-JJ : mois des dépenses de la note, 24 mois au
//                                         plus, les 24 derniers par défaut), statut, page (100 notes, de la plus récente à
//                                         la plus ancienne) : en-têtes des notes, total remboursé de chacune
//   GET /api/frais/historique/:noteId     une note, ses dépenses et la description de leurs justificatifs (le fichier se
//                                         lit par GET /api/pieces/:id, contrôlé et tracé comme les autres)
// Toutes les notes de la base, dans la fenêtre ou non, filtrées par les MÊMES règles que l'instantané
// (server/src/frais-vues.ts) :
// - collaborateur : les siennes ;
// - manager : les siennes, et celles des salariés dont il valide les frais aujourd'hui (`idsFrais` : équipe directe et
//   délégations « frais »), jamais une note médicale d'un autre ni ses lignes ; justificatifs comme dans l'instantané ;
// - service RH (droit « rh ») : tout ; comptabilité (droit « compta ») : tout, frais médicaux compris, justificatifs sans
//   empreinte ;
// - paie : notes contrôlées, en paiement ou payées, sans lignes ni justificatifs, sans motif ni indicateur médical ;
// - référent HSE et lecture seule : 403, refus tracé (`acces.refuse`), sans rien révéler.
// Consultation par le service RH ou la comptabilité de l'historique d'un autre salarié tracée `frais.historique.consulter`
// (salariés et nombre de notes seulement, jamais un critère ni un montant ; journal d'un an). Un identifiant de note
// inconnu et celui d'une note hors du périmètre reçoivent la même réponse (403), sauf pour le service RH et la
// comptabilité, qui voient tout (404). Les deux routes sont gardées contre une navigation provoquée depuis un autre site
// (server/src/app.ts, exigerNavigationInterne('appel')) : l'écran les lit par fetch, avec l'en-tête d'espace.
import express, { type Request, type Response, type Router } from 'express';
import { droitsRh } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import { plural } from '../../shared/format.ts';
import { HISTORIQUE_FRAIS_PAGE, periodeHistorique } from '../../shared/rules/frais-fenetre.ts';
import { lignesDe, montantRetenu, r2, STATUTS_NOTE_FRAIS } from '../../shared/rules/frais.ts';
import type { CurrentUser, LigneFrais, NoteFrais, Piece } from '../../shared/types.ts';
import { jeuEnLecture } from './cache-instantane.ts';
import { journaliser } from './comptes.ts';
import { identite, type Identite } from './connexion.ts';
import { idsFrais, loadFull, loadSettings, todayIso } from './dataset.ts';
import type { Db, SqlValeur } from './db.ts';
import { lignesDesNotesEnBase, piecesDesLignesEnBase } from './frais-base.ts';
import { lignesDesNotes, notesPourLaPaie, notesVuesSalarie, piecesFraisComptabilite, piecesFraisDeManager, POUR_LA_PAIE } from './frais-vues.ts';
import { tracerRefus } from './journal.ts';
import { piecesDe, piecesVisibles } from './pieces.ts';

/** Ce que voit la personne connectée : profil de l'espace RH, ou salarié (manager, collaborateur) et ses `idsFrais`. */
export type ProfilHistorique = { mode: 'rh' } | { mode: 'compta' } | { mode: 'paie' } | { mode: 'salarie'; moi: number; ids: ReadonlySet<number> };

/** Profil de lecture de l'historique ; null : référent HSE, lecture seule (aucun accès aux frais d'autrui ni aux siens ici). */
export async function profilHistorique(db: Db, user: CurrentUser): Promise<ProfilHistorique | null> {
  if (user.role === 'rh') {
    const droits = droitsRh(user);
    if (droits.includes('rh')) return { mode: 'rh' };
    if (droits.includes('compta')) return { mode: 'compta' };
    // Paie : comme dans l'instantané (`fraisVueProfil`), le droit « paie » sans le droit « rh ».
    if (droits.includes('paie')) return { mode: 'paie' };
    return null;
  }
  if (!user.empId) return null;
  if (user.role === 'collaborateur') return { mode: 'salarie', moi: user.empId, ids: new Set() };
  // Manager : salariés dont il valide les frais aujourd'hui, calculés comme pour l'instantané sur le jeu complet (cache).
  const full = await db.lecture(async () => await jeuEnLecture(db, user, todayIso(), async u => await loadFull(db, u)));
  return { mode: 'salarie', moi: user.empId, ids: idsFrais(new Domain(full), user) };
}

/** Notes vues par le profil, projetées comme dans l'instantané. */
export function notesDuProfil(p: ProfilHistorique, notes: readonly NoteFrais[]): NoteFrais[] {
  if (p.mode === 'paie') return notesPourLaPaie(notes);
  if (p.mode === 'salarie') return notesVuesSalarie(notes, p.moi, p.ids);
  return [...notes];
}

/** Dépenses vues par le profil : celles des notes reçues ; aucune pour la paie. */
export const lignesDuProfil = (p: ProfilHistorique, lignes: readonly LigneFrais[], notes: readonly NoteFrais[]): LigneFrais[] =>
  (p.mode === 'paie' ? [] : lignesDesNotes(lignes, notes));

/** Justificatifs vus par le profil (description, jamais le fichier), comme dans l'instantané. */
export function piecesDuProfil(p: ProfilHistorique, user: CurrentUser, pieces: readonly Piece[]): Piece[] {
  if (p.mode === 'rh') return [...pieces];
  if (p.mode === 'compta') return piecesFraisComptabilite(pieces);
  if (p.mode === 'paie') return [];
  return [...piecesVisibles(pieces, user), ...piecesFraisDeManager(pieces, p.moi, p.ids)];
}

/** Condition SQL (alias `notes_frais`) des notes que le profil peut recevoir, pour une pagination exacte. */
function perimetreSql(p: ProfilHistorique): { where: string; params: SqlValeur[] } {
  if (p.mode === 'paie') return { where: `statut IN (${POUR_LA_PAIE.map(() => '?').join(', ')})`, params: [...POUR_LA_PAIE] };
  if (p.mode === 'salarie') {
    const autres = [...p.ids];
    return autres.length
      ? { where: `(emp_id = ? OR (medicale = FALSE AND emp_id IN (${autres.map(() => '?').join(', ')})))`, params: [p.moi, ...autres] }
      : { where: 'emp_id = ?', params: [p.moi] };
  }
  return { where: '1 = 1', params: [] };
}

/** Le salarié `empId` est-il dans le périmètre du profil (filtre `empId` de la recherche) ? */
const salarieVisible = (p: ProfilHistorique, empId: number) => p.mode !== 'salarie' || empId === p.moi || p.ids.has(empId);

/** Total remboursé d'une note (montants retenus de ses dépenses en vigueur), en euros. */
const totalNote = (lignes: readonly LigneFrais[], noteId: number) => r2(lignesDe(lignes, noteId).reduce((s, l) => s + montantRetenu(l), 0));

/** Trace de la consultation, par le service RH ou la comptabilité, de notes d'autres salariés : salariés et nombre seulement. */
async function tracerConsultation(db: Db, id: Identite, p: ProfilHistorique, notes: readonly NoteFrais[]) {
  if (p.mode !== 'rh' && p.mode !== 'compta') return;
  const autrui = notes.filter(n => n.empId !== id.user.empId);
  if (!autrui.length) return;
  await db.tx(async () => await journaliser(db, {
    actor: id.user.nom, role: id.user.role, action: 'frais.historique.consulter', compte: id.compte, salaries: [...new Set(autrui.map(n => n.empId))],
    message: `Historique des notes de frais consulté — ${plural(autrui.length, 'note', 'notes')}`,
    payload: { notes: autrui.length },
  }));
}

export function routesFraisHistorique(db: Db): Router {
  const r = express.Router();

  /** Personne connectée qui lit l'historique, et son profil ; sinon réponse 401, 403 (refus tracé) ou 409. */
  async function lecteur(req: Request, res: Response, quoi: string): Promise<{ id: Identite; p: ProfilHistorique } | null> {
    const id = await identite(db, req);
    if (!id) { res.status(401).json({ error: 'Connexion requise' }); return null; }
    const p = await profilHistorique(db, id.user);
    if (!p) {
      await db.tx(async () => await tracerRefus(db, id, quoi, 'notes de frais hors de ce profil'));
      res.status(403).json({ error: 'Historique des notes de frais : hors de vos droits' });
      return null;
    }
    if (!(await loadSettings(db)).notesFraisActives) {
      res.status(409).json({ error: 'Notes de frais désactivées : l’administrateur RH les active dans Paramètres' });
      return null;
    }
    return { id, p };
  }

  r.get('/api/frais/historique', async (req: Request, res: Response) => {
    const l = await lecteur(req, res, 'Historique des notes de frais');
    if (!l) return;
    const { id, p } = l;
    const q = req.query as Record<string, unknown>;
    const periode = periodeHistorique(q, todayIso());
    if ('erreur' in periode) return res.status(400).json({ error: periode.erreur });
    const statut = q.statut === undefined || q.statut === '' ? null : String(q.statut);
    if (statut !== null && !Object.hasOwn(STATUTS_NOTE_FRAIS, statut)) return res.status(400).json({ error: 'Statut inconnu' });
    const page = q.page === undefined || q.page === '' ? 1 : Number(q.page);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) return res.status(400).json({ error: 'Page invalide' });
    let empId: number | null = null;
    if (q.empId !== undefined && q.empId !== '') {
      empId = Number(q.empId);
      if (!Number.isInteger(empId) || empId <= 0) return res.status(400).json({ error: 'Salarié invalide' });
      // Hors du périmètre : refus tracé, sans dire si le salarié existe ni s'il a des notes.
      if (!salarieVisible(p, empId)) {
        await db.tx(async () => await tracerRefus(db, id, 'Historique des notes de frais', 'salarié hors de votre périmètre'));
        return res.status(403).json({ error: 'Historique des notes de frais : salarié hors de votre périmètre' });
      }
    }
    const perimetre = perimetreSql(p);
    const conditions = ['periode >= ?', 'periode <= ?', perimetre.where];
    const params: SqlValeur[] = [periode.du, periode.au, ...perimetre.params];
    if (statut) { conditions.push('statut = ?'); params.push(statut); }
    if (empId) { conditions.push('emp_id = ?'); params.push(empId); }
    const ou = conditions.join(' AND ');
    const lu = await db.lecture(async () => {
      const total = Number((await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM notes_frais WHERE ${ou}`, params))?.n ?? 0);
      const ids = (await db.query<{ id: number }>(`SELECT id FROM notes_frais WHERE ${ou} ORDER BY id DESC LIMIT ${HISTORIQUE_FRAIS_PAGE} OFFSET ${(page - 1) * HISTORIQUE_FRAIS_PAGE}`, params))
        .map(x => String(x.id));
      const notes = ids.length ? (await db.lireLignes<NoteFrais>('notesFrais', ids)).sort((a, b) => b.id - a.id) : [];
      const lignes = p.mode === 'paie' ? [] : await lignesDesNotesEnBase(db, notes.map(n => n.id));
      return { total, notes, lignes };
    });
    // Mêmes règles que l'instantané, appliquées aux notes lues (la condition SQL n'en est que l'avance, pour la pagination).
    const notes = notesDuProfil(p, lu.notes);
    const lignes = lignesDuProfil(p, lu.lignes, notes);
    await tracerConsultation(db, id, p, notes);
    res.set('Cache-Control', 'no-store').json({
      du: periode.du, au: periode.au, page, parPage: HISTORIQUE_FRAIS_PAGE, total: lu.total, pages: Math.max(1, Math.ceil(lu.total / HISTORIQUE_FRAIS_PAGE)),
      notes,
      // Total remboursé de chaque note : pas pour la paie, qui ne reçoit pas les dépenses (le lot porte les montants).
      totaux: p.mode === 'paie' ? {} : Object.fromEntries(notes.map(n => [n.id, totalNote(lignes, n.id)])),
    });
  });

  r.get('/api/frais/historique/:noteId', async (req: Request, res: Response) => {
    const l = await lecteur(req, res, 'Note de frais de l’historique');
    if (!l) return;
    const { id, p } = l;
    const lu = await db.lecture(async () => {
      const n = await db.get<NoteFrais>('notesFrais', Number(req.params.noteId) || 0);
      const vue = n ? notesDuProfil(p, [n])[0] : undefined;
      if (!n || !vue) return { n, vue: undefined, lignes: [], pieces: [] };
      const lignes = p.mode === 'paie' ? [] : await lignesDesNotesEnBase(db, [n.id]);
      const pieces = lignes.length ? piecesDe(await piecesDesLignesEnBase(db, lignes.map(x => x.id))) : [];
      return { n, vue, lignes, pieces };
    });
    if (!lu.vue) {
      if (lu.n) await db.tx(async () => await tracerRefus(db, id, 'Note de frais de l’historique', 'note hors de votre périmètre'));
      // Même réponse pour une note inconnue et pour celle d'un autre ; le service RH et la comptabilité voient tout.
      return (p.mode === 'rh' || p.mode === 'compta') && !lu.n
        ? res.status(404).json({ error: 'Note de frais introuvable' })
        : res.status(403).json({ error: 'Note de frais introuvable ou hors de votre périmètre' });
    }
    const lignes = lignesDuProfil(p, lu.lignes, [lu.vue]);
    const ids = new Set(lignes.map(x => x.id));
    await tracerConsultation(db, id, p, [lu.vue]);
    res.set('Cache-Control', 'no-store').json({
      note: lu.vue, lignes,
      pieces: piecesDuProfil(p, id.user, lu.pieces.filter(x => ids.has(x.objetId))),
    });
  });

  return r;
}
