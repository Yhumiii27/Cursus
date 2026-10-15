// Migrations de données des bases créées par une version antérieure de Cursus.
import { estMotifReprise, MISSION_LONGUE_JOURS, type MotifReprise, VACCINS } from '../../shared/constants.ts';
import { Domain } from '../../shared/domain.ts';
import { matricule, norm, plural } from '../../shared/format.ts';
import { days, parse } from '../../shared/dates.ts';
import { formaliteCle } from '../../shared/rules/formalites.ts';
import { inscritsDe } from '../../shared/rules/sessions.ts';
import type {
  CurrentUser, Declaration, DemandeCollab, Destination, Participation, Session, SessionBilan, Vaccination, VaccinId, Visa, Voyage,
} from '../../shared/types.ts';
import { journaliser } from './comptes.ts';
import { loadFull, todayIso } from './dataset.ts';
import type { Db } from './db.ts';
import { migrerKeystone } from './integrations/keystone-entrant.ts';
import { reprendreAdressesDesComptes } from './messagerie.ts';
import { sauvegarderAvantMigration } from './sauvegarde.ts';

/** Ancienne colonne `contrat` (qui mêlait nature du contrat et durée du travail) → statut, type de contrat, temps. */
const ANCIEN_CONTRAT: Record<string, { typeContrat: string; temps: string; cadre?: boolean }> = {
  '35h': { typeContrat: 'cdi', temps: '35h' },
  '39h': { typeContrat: 'cdi', temps: '39h_rtt' },
  forfait: { typeContrat: 'cdi', temps: 'forfait_jours', cadre: true },
  reel: { typeContrat: 'cdi', temps: '35h', cadre: true },
  partiel: { typeContrat: 'cdi', temps: 'partiel' },
  alternance: { typeContrat: 'alternance', temps: '35h' },
  cdd: { typeContrat: 'cdd', temps: '35h' },
  interim: { typeContrat: 'interim', temps: '35h' },
};

/** Catégorie déduite de l'ancien contrat et de l'intitulé de poste, faute de mieux. */
function statutDuPoste(poste: string, contrat: string): string {
  if (contrat === 'alternance' || /apprenti|assistant/i.test(poste)) return 'ouvrier';
  if (/\bdirect(eur|rice)\b|responsable|ingénieur|cadre|chargée? d[’']affaires|grands comptes/i.test(poste)) return 'cadre';
  if (/technicien|chef|maîtrise|animat|audit|gestionnaire|chargé|électromécanicien/i.test(poste)) return 'technicien';
  return 'ouvrier';
}

export function migrate(db: Db) {
  // Une base réellement modifiée est d'abord copiée (une seule copie pour toutes les étapes).
  const avant = () => { sauvegarderAvantMigration(db); };
  convertirContrats(db, avant);
  figerFeuilles(db, avant);
  libererPlacesRemplacees(db, avant);
  reprendreDeclarations(db, avant);
  migrerKeystone(db, avant);
  validationParDefaut(db, avant);
  reprendreSessions(db, avant);
  motifsDeReprise(db, avant);
  reprendreAdressesDesComptes(db, avant);
  reprendreDetachements(db, avant);
}

/**
 * Termes médicaux d'un ancien motif de reprise : le texte devient « absence longue » même s'il nomme aussi un cas de
 * la liste (« temps partiel thérapeutique », « congé de présence parentale », « maternité pathologique »).
 */
const MOTIF_MEDICAL = /therapeut|maladi|malade|medic|\bsante\b|accident|invalid|handicap|presence parentale|patholog|cancer|chimio|depress|psych|burn.?out|hospital|hopital|chirurg|convalesc|inapt|\bald\b/;

/**
 * Motif de reprise d'une ancienne fiche (texte libre) ramené à la liste fermée `MOTIFS_REPRISE` ; un texte médical, ou
 * qui ne correspond à aucun cas de la liste (« longue maladie », une pathologie…), devient « absence longue », masqué au
 * manager comme un arrêt longue maladie. Le texte d'origine n'est pas conservé : il pouvait porter une information
 * médicale. Les termes médicaux sont cherchés d'abord, et chaque cas de la liste exige ses propres mots : un motif
 * médical ne devient jamais un motif non médical faux, que le manager recevrait.
 */
export function motifRepriseDuTexte(texte: string): MotifReprise {
  if (estMotifReprise(texte)) return texte;
  const t = norm(texte);
  if (MOTIF_MEDICAL.test(t)) return 'absence longue';
  if (/matern/.test(t)) return 'congé de maternité';
  if (/adopt/.test(t)) return 'congé d’adoption';
  if (/parental/.test(t) && /temps partiel|mi.temps/.test(t)) return 'temps partiel parental';
  if (/conge parental|parental d.education/.test(t)) return 'congé parental d’éducation';
  if (/proche aidant|conge (d.)?aidant/.test(t)) return 'congé de proche aidant';
  if (/sabbat/.test(t)) return 'congé sabbatique';
  if (/mobilite volontaire/.test(t)) return 'mobilité volontaire sécurisée';
  if (/mandat|syndic/.test(t)) return 'mandat syndical';
  return 'absence longue';
}

/** Fiches dont le motif de reprise n'est pas dans la liste fermée (bases antérieures) : motif converti. */
export function motifsDeReprise(db: Db, avant = () => {}) {
  const rows = (db.sql.prepare('SELECT id, reprise_motif AS motif FROM employes WHERE reprise_motif IS NOT NULL').all() as { id: number; motif: string }[])
    .filter(r => !estMotifReprise(r.motif));
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) db.sql.prepare('UPDATE employes SET reprise_motif = ? WHERE id = ?').run(motifRepriseDuTexte(r.motif), r.id);
  });
  console.log(`Migration : ${plural(rows.length, 'motif de reprise ramené', 'motifs de reprise ramenés')} à la liste fermée (aucun texte libre conservé).`);
}

/** Réglage : date de la reprise des formalités de détachement, faite une seule fois par base. */
export const REPRISE_DETACHEMENT = 'repriseDetachement';

/**
 * Formalités de détachement (certificat de sécurité sociale, information écrite d'une mission de plus de 4 semaines) :
 * une base antérieure à leur suivi n'en a aucune. Les déplacements déjà partis et pas encore rentrés à la mise à jour
 * sont réputés en règle (formalités faites hors de Cursus, datées du départ) : sans cela, le premier recalcul enverrait
 * à Keystone un No Go DETACHEMENT pour des salariés déjà sur place. Tracé dans le journal. Une seule fois par base : un
 * déplacement parti ensuite sans formalité reste bloquant. Ceux à venir sont à compléter par le service RH (réserve
 * jusqu'au départ ; docs/DEPLOIEMENT.md, « Mise à jour »).
 */
export function reprendreDetachements(db: Db, avant = () => {}) {
  if (db.getSetting<string | null>(REPRISE_DETACHEMENT, null)) return;
  const ti = todayIso();
  const repris = db.all<Voyage>('voyages')
    .filter(v => v.depart <= ti && v.retour >= ti)
    .map(v => {
      const longue = days(parse(v.depart), parse(v.retour)) + 1 > MISSION_LONGUE_JOURS;
      const maj: Partial<Voyage> = {
        ...(v.detachementLe ? {} : { detachementLe: v.depart }), ...(longue && !v.informationLe ? { informationLe: v.depart } : {}),
      };
      return { v, maj };
    })
    .filter(x => Object.keys(x.maj).length);
  if (repris.length) {
    avant();
    db.tx(() => {
      repris.forEach(({ v, maj }) => db.update<Voyage>('voyages', v.id, maj));
      const message = `Reprise : formalités de détachement réputées faites au départ pour ${plural(repris.length, 'déplacement en cours', 'déplacements en cours')} à la mise à jour`;
      journaliser(db, {
        actor: 'Cursus', role: null, action: 'migration.detachement', message,
        payload: { voyages: repris.map(({ v }) => ({ id: v.id, matricule: matricule(v.empId), dest: v.dest, depart: v.depart, retour: v.retour })) },
      });
    });
    console.log(`Migration : formalités de détachement reprises pour ${plural(repris.length, 'déplacement en cours', 'déplacements en cours')}.`);
  }
  db.setSetting(REPRISE_DETACHEMENT, ti);
}

/** Auteur de la clôture des sessions reprises d'une base antérieure au cycle de vie des sessions. */
const REPRISE: CurrentUser = { role: 'rh', empId: null, nom: 'Cursus', intitule: 'Reprise de l’historique' };

/**
 * Sessions d'une base antérieure au cycle de vie (ancienne colonne `inscrits` renseignée) : une session passée
 * où il n'y a rien à décider (aucun inscrit, ou recyclages déjà enregistrés depuis) est clôturée, avec un résultat
 * pour chaque recyclage déjà enregistré, comme le ferait le service RH. Une session qui a encore un inscrit sans
 * résultat reste à clôturer. Une seule fois par session : l'ancienne colonne est ensuite vidée. Après
 * `libererPlacesRemplacees` : une place tenue par une certification remplacée avant la session n'est pas un inscrit.
 */
export function reprendreSessions(db: Db, avant = () => {}) {
  if (!db.columns('sessions').includes('inscrits')) return;
  const anciennes = new Set((db.sql.prepare('SELECT id FROM sessions WHERE inscrits IS NOT NULL').all() as { id: number }[]).map(r => r.id));
  if (!anciennes.size) return;
  avant();
  const d = new Domain(loadFull(db, REPRISE));
  let n = 0;
  db.tx(() => {
    for (const s of d.aCloturer().filter(x => anciennes.has(x.id))) {
      const inscrits = inscritsDe(d, s);
      if (inscrits.some(i => !i.dejaObtenue)) continue;
      for (const i of inscrits) {
        db.insert<Participation>('participations', { sessionId: s.id, empId: i.empId, parcours: i.parcours, present: true, reussi: null, certId: i.dejaObtenue!.id });
      }
      const bilan: SessionBilan = {
        le: d.ti, par: REPRISE.nom, note: null, motif: null,
        commentaire: 'Session antérieure au suivi des clôtures, sans inscrit à décider : clôturée à la mise à jour de Cursus.',
      };
      db.update<Session>('sessions', s.id, { statut: 'Clôturée', bilan });
      n++;
    }
    db.sql.prepare('UPDATE sessions SET inscrits = NULL').run();
  });
  if (n) console.log(`Migration : ${plural(n, 'session passée clôturée', 'sessions passées clôturées')} (aucun inscrit à décider).`);
}

/**
 * Formations d'une base antérieure au mode de validation : la présence suffit, jusqu'à ce que le
 * service RH exige une évaluation réussie dans le catalogue.
 */
export function validationParDefaut(db: Db, avant = () => {}) {
  const n = Number((db.sql.prepare('SELECT COUNT(*) AS n FROM formations WHERE validation IS NULL').get() as { n: number }).n);
  if (!n) return;
  avant();
  db.sql.prepare(`UPDATE formations SET validation = 'presence' WHERE validation IS NULL`).run();
  console.log(`Migration : mode de validation « présence » appliqué à ${plural(n, 'formation', 'formations')} du catalogue.`);
}

/**
 * Demandes « document » restées en attente d'une version qui écrivait la formalité tout de suite :
 * le contenu déclaré est repris du dossier (`dejaAuDossier`) pour que le RH voie ce qu'il valide,
 * et un refus le retire du dossier. Les demandes acceptées ou refusées restent telles quelles.
 *
 * Seule la demande la plus récente de chaque document le reprend : le dossier ne garde que la dernière
 * saisie, et deux demandes portant la même pièce se contrediraient (l'une la retire, l'autre la confirme).
 * Les plus anciennes restent sans contenu, à contrôler dans le dossier comme avant.
 */
export function reprendreDeclarations(db: Db, avant = () => {}) {
  // Demande la plus récente de chaque document, tous statuts confondus : une fois celle-ci traitée,
  // les plus anciennes ne reprennent rien aux démarrages suivants.
  const derniere = new Map<string, { r: DemandeCollab; doc: DocVise }>();
  const docs = db.all<DemandeCollab>('demandesCollab').filter(r => r.type === 'document')
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const r of docs) {
    const doc = r.declaration ?? documentDuLibelle(db, r.label ?? '');
    if (doc) derniere.set(`${r.empId}:${formaliteCle(doc)}`, { r, doc });
  }
  const rows = [...derniere.values()].filter(({ r }) => r.statut === 'attente' && !r.declaration);
  if (!rows.length) return;
  avant();
  let n = 0;
  db.tx(() => {
    for (const { r, doc } of rows) {
      const x = declarationDuDossier(db, r.empId, doc);
      if (!x) continue; // document absent : le RH contrôle dans le dossier, comme avant
      db.update<DemandeCollab>('demandesCollab', r.id, { declaration: { ...x, dejaAuDossier: true } });
      n++;
    }
  });
  if (n) console.log(`Migration : ${plural(n, 'déclaration en attente reprise', 'déclarations en attente reprises')} du dossier.`);
}

/** Document visé par une demande : le passeport, le visa d'un pays ou la vaccination d'un vaccin. */
type DocVise = { kind: 'passeport' } | { kind: 'visa'; dest: string } | { kind: 'vaccin'; v: VaccinId };

/** Document visé par le libellé d'une ancienne demande (« Passeport mis à jour », « Visa Inde déclaré »…). */
function documentDuLibelle(db: Db, label: string): DocVise | null {
  if (label === 'Passeport mis à jour') return { kind: 'passeport' };
  const visa = /^Visa (.+) déclaré$/.exec(label);
  if (visa) {
    const dest = db.all<Destination>('destinations').find(x => x.pays === visa[1]);
    return dest ? { kind: 'visa', dest: dest.code } : null;
  }
  const vac = /^Vaccination (.+) déclarée$/.exec(label);
  const v = vac && (Object.keys(VACCINS) as VaccinId[]).find(k => VACCINS[k].nom.replace(/ \(.*\)/, '') === vac[1]);
  return v ? { kind: 'vaccin', v } : null;
}

/** Formalité enregistrée dans le dossier pour ce document. */
function declarationDuDossier(db: Db, empId: number, doc: DocVise): Declaration | null {
  if (doc.kind === 'passeport') {
    const e = db.get<{ passeportNumero: string | null; passeportExpire: string | null }>('employes', empId);
    return e?.passeportNumero && e.passeportExpire ? { kind: 'passeport', numero: e.passeportNumero, expire: e.passeportExpire } : null;
  }
  if (doc.kind === 'visa') {
    const v = db.where<Visa>('visas', 'empId', empId).filter(x => x.dest === doc.dest).at(-1);
    return v ? { kind: 'visa', dest: v.dest, type: v.type, obtenu: v.obtenu, expire: v.expire } : null;
  }
  const r = db.where<Vaccination>('vaccinations', 'empId', empId).filter(x => x.v === doc.v).at(-1);
  return r ? { kind: 'vaccin', v: doc.v, date: r.date } : null;
}

/**
 * Les feuilles soumises ou validées avant le gel du régime reçoivent le régime actuel de la fiche.
 * `avant` est appelé juste avant d'écrire (sauvegarde au démarrage ; rien au chargement de la démo).
 */
export function figerFeuilles(db: Db, avant = () => {}) {
  const rows = db.sql.prepare(`SELECT f.id, e.statut, e.type_contrat, e.temps, e.heures, e.forfait_heures, e.forfait_jours, e.jour_off
    FROM feuilles f JOIN employes e ON e.id = f.emp_id WHERE f.contrat IS NULL AND f.statut IN ('soumise', 'validee') AND e.temps IS NOT NULL`).all() as Record<string, unknown>[];
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) {
      const contrat = { statut: r.statut, typeContrat: r.type_contrat, temps: r.temps, heures: r.heures, forfaitHeures: r.forfait_heures, forfaitJours: r.forfait_jours, jourOff: JSON.parse(String(r.jour_off ?? '[]')) };
      db.sql.prepare('UPDATE feuilles SET contrat = ? WHERE id = ?').run(JSON.stringify(contrat), r.id as number);
    }
  });
}

function convertirContrats(db: Db, avant: () => void) {
  if (!db.columns('employes').includes('contrat')) return;
  const rows = db.sql.prepare('SELECT id, contrat, poste FROM employes WHERE temps IS NULL AND contrat IS NOT NULL').all() as { id: number; contrat: string; poste: string }[];
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) {
      const m = ANCIEN_CONTRAT[r.contrat] ?? ANCIEN_CONTRAT['35h'];
      db.sql.prepare('UPDATE employes SET type_contrat = ?, temps = ?, statut = ?, forfait_jours = ? WHERE id = ?')
        .run(m.typeContrat, m.temps, m.cadre ? 'cadre' : statutDuPoste(r.poste, r.contrat), m.temps === 'forfait_jours' ? 218 : null, r.id);
    }
  });
  console.log(`Migration : ${rows.length} fiches converties au nouveau modèle de contrat.`);
}

/**
 * Avant la règle de la certification en vigueur, un recyclage enregistré laissait la certification remplacée
 * inscrite à sa session : dans une session ouverte (à venir, ou passée et pas encore clôturée) postérieure
 * au recyclage, cette place est libérée (même règle que `cert.ajouter`) ; la clôture n'y verra donc pas une
 * présence que rien n'atteste. Le nombre d'inscrits, calculé au chargement, suit (l'ancienne colonne
 * `inscrits` n'est plus lue).
 */
export function libererPlacesRemplacees(db: Db, avant = () => {}) {
  const rows = db.sql.prepare(`SELECT c.id FROM certifications c JOIN sessions s ON s.id = c.session_id
    WHERE (s.statut IS NULL OR s.statut NOT IN ('Clôturée', 'Annulée')) AND EXISTS (SELECT 1 FROM certifications n WHERE n.emp_id = c.emp_id AND n.f = c.f
      AND (n.obtenue > c.obtenue OR (n.obtenue = c.obtenue AND n.id > c.id)) AND n.obtenue < s.date)`).all() as { id: number }[];
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) db.sql.prepare('UPDATE certifications SET session_id = NULL, convoc = NULL WHERE id = ?').run(r.id);
  });
  console.log(`Migration : ${plural(rows.length, 'place de session libérée', 'places de session libérées')} (certifications remplacées par un recyclage).`);
}
