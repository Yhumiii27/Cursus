// Migrations de données des bases créées par une version antérieure de Cursus.
import { VACCINS } from '../../shared/constants.ts';
import { plural } from '../../shared/format.ts';
import { formaliteCle } from '../../shared/rules/formalites.ts';
import type { Declaration, DemandeCollab, Destination, Vaccination, VaccinId, Visa } from '../../shared/types.ts';
import { todayIso } from './dataset.ts';
import type { Db } from './db.ts';
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
  libererPlacesRemplacees(db, todayIso(), avant);
  reprendreDeclarations(db, avant);
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
 * inscrite à sa session à venir : cette place, devenue invisible, est libérée (même règle que `cert.ajouter`).
 */
export function libererPlacesRemplacees(db: Db, today: string, avant = () => {}) {
  const rows = db.sql.prepare(`SELECT c.id, c.session_id FROM certifications c JOIN sessions s ON s.id = c.session_id
    WHERE s.date >= ? AND EXISTS (SELECT 1 FROM certifications n WHERE n.emp_id = c.emp_id AND n.f = c.f
      AND (n.obtenue > c.obtenue OR (n.obtenue = c.obtenue AND n.id > c.id)) AND n.obtenue < s.date)`).all(today) as { id: number; session_id: number }[];
  if (!rows.length) return;
  avant();
  db.tx(() => {
    for (const r of rows) {
      db.sql.prepare('UPDATE sessions SET inscrits = MAX(0, inscrits - 1) WHERE id = ?').run(r.session_id);
      db.sql.prepare('UPDATE certifications SET session_id = NULL, convoc = NULL WHERE id = ?').run(r.id);
    }
  });
  console.log(`Migration : ${plural(rows.length, 'place de session libérée', 'places de session libérées')} (certifications remplacées par un recyclage).`);
}
