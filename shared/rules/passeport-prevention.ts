// Passeport de prévention (lot 7, chantier B, t066 ; art. L4141-5) : formations santé-sécurité que l'employeur déclare sur
// la plateforme de la Caisse des dépôts. Le format d'import côté employeur et le calendrier d'ouverture aux employeurs ne
// sont pas connus (rien dans les réponses de l'entreprise) : Cursus marque les formations au catalogue, calcule les lignes
// à déclarer, en garde la date de déclaration et produit un export CSV au gabarit de colonnes réglable, avec la mention
// « format à confirmer sur la plateforme ». Aucun NIR dans Cursus : la colonne, facultative, reste vide (rapprochement par
// le matricule de paie dans Sage).
// - Marquage (`Formation.passeportPrevention`) : coché par la migration lot7-prevention-passeport sur les formations
//   santé-sécurité du catalogue (SST, CACES, ATEX, électrique, AIPR, EPI incendie, travail en hauteur, PRAP), modifiable
//   dans Référentiels → Formations. `passeportPropose` reprend la même liste pour l'aide du dialogue.
// - Lignes (`lignesPasseport`) : certifications obtenues (non annulées) et formations suivies (non annulées, hors celles
//   que représente déjà une certification : `suivieCertifiee`) des formations marquées, dont le dernier jour tombe dans la
//   période ; identité lue sur la fiche (dossiers anonymisés écartés). Une certification est toujours datée de son
//   obtention : dates et heures d'une session seulement pour celle qu'une session clôturée a produite. Une ligne déclarée
//   (`DeclarationPasseport`) n'est plus proposée, sauf à demander aussi les lignes déjà déclarées.
// - Export (`exportPasseport`) : colonnes du réglage `passeportColonnes`, dans l'ordre du gabarit ; produit par le serveur
//   (server/src/passeport-prevention.ts), qui seul connaît la date de naissance, et tracé au journal.
import { fmtIso } from '../format.ts';
import { isValidDate } from '../dates.ts';
import type { Domain } from '../domain.ts';
import type { ColonnePasseport, DeclarationPasseport, Employe, Formation, ISODate, LignePasseport, Session } from '../types.ts';
import { heuresSession } from './heures-formation.ts';
import { heuresSuivie, suivieCertifiee, suiviesEnVigueur } from './formations-suivies.ts';
import { matriculeAffiche } from './matricules.ts';

export const ARTICLE_PASSEPORT = 'art. L4141-5';
/** Mention portée par l'écran et par chaque ligne exportée : le format d'import de la plateforme n'est pas connu. */
export const MENTION_PASSEPORT = 'Format à confirmer sur la plateforme du Passeport de prévention';

// — Marquage du catalogue —

/**
 * Formations santé-sécurité proposées au Passeport de prévention, reconnues sur le code, le nom court ou l'intitulé
 * (minuscules, sans accent) : même liste que la migration lot7-prevention-passeport (server/src/migrations/lot7-prevention.ts),
 * qui en garde sa propre copie figée.
 */
export const MOTS_PASSEPORT: readonly RegExp[] = [
  /\bsst\b/, /sauveteur/, /caces/, /atex/, /electri/, /\belec\b/, /\baipr\b/, /incendie/, /\bepi\b/, /hauteur/, /\bprap\b/,
];
const sansAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Formation qui ressemble à une formation santé-sécurité : proposée au marquage (jamais cochée d'office à la saisie). */
export function passeportPropose(f: Pick<Formation, 'id' | 'court' | 'nom'>): boolean {
  const t = sansAccent(`${f.id} ${f.court} ${f.nom}`);
  return MOTS_PASSEPORT.some(m => m.test(t));
}

/** Formation marquée « Passeport de prévention » au catalogue. */
export const marqueePasseport = (f: Pick<Formation, 'passeportPrevention'> | null | undefined): boolean => !!f?.passeportPrevention;

// — Lignes à déclarer —

/** Clé d'une ligne : origine et identifiant de la certification ou de la formation suivie. */
export const cleLigne = (x: { certId?: number | null; suivieId?: number | null }) => (x.certId ? `cert:${x.certId}` : `suivie:${x.suivieId}`);

/** Période d'une recherche : bornes comprises, sur le dernier jour de la formation. */
export interface PeriodePasseport { du: ISODate; au: ISODate; declarees?: boolean }

/** Résultat d'une certification : évaluation réussie, ou présence quand la formation ne demande pas d'évaluation. */
const resultatCert = (fm: Formation | undefined) => (fm?.validation === 'evaluation' ? 'Acquise (évaluation réussie)' : 'Acquise (présence)');

/**
 * Lignes à déclarer sur la période (dernier jour compris entre `du` et `au`) : certifications et formations suivies des
 * formations marquées, salariés non anonymisés ; déjà déclarées exclues, sauf `declarees`. Triées par date puis par nom.
 */
export function lignesPasseport(d: Domain, p: PeriodePasseport): LignePasseport[] {
  const declarees = new Map((d.ds.declarationsPasseport ?? []).map(x => [cleLigne(x), x.declareLe]));
  const sessions = new Map(d.ds.sessions.map(s => [s.id, s]));
  // Sessions clôturées qui ont produit une certification (`Participation.certId`, posé par session.cloturer). Le
  // `sessionId` d'une certification désigne au contraire le recyclage où elle est inscrite : il ne la date jamais.
  const sessionsDe = new Map<number, Session[]>();
  for (const x of d.ds.participations ?? []) {
    const s = x.certId ? sessions.get(x.sessionId) : undefined;
    if (s?.statut === 'Clôturée') sessionsDe.set(x.certId!, [...sessionsDe.get(x.certId!) ?? [], s]);
  }
  const dans = (j: ISODate) => j >= p.du && j <= p.au;
  const out: LignePasseport[] = [];
  const ajouter = (l: Omit<LignePasseport, 'cle' | 'declareLe'>) => {
    const cle = cleLigne(l), declareLe = declarees.get(cle) ?? null;
    if (declareLe && !p.declarees) return;
    out.push({ ...l, cle, declareLe });
  };
  const nominatif = (e: Employe | undefined): e is Employe => !!e && !e.anonymiseLe;
  for (const e of d.ds.employes) {
    if (!nominatif(e)) continue;
    for (const c of e.certs) {
      const fm = d.fm(c.f);
      if (c.annuleLe || !marqueePasseport(fm)) continue;
      // Certification issue d'une session : celle qui finit le jour de l'obtention (un salarié déjà certifié figure aussi
      // aux participations d'un recyclage ultérieur, avec sa certification). Sinon le jour d'obtention seul.
      const s = (sessionsDe.get(c.id) ?? []).find(x => (x.fin ?? x.date) === c.obtenue);
      const du = s ? s.date : c.obtenue, au = c.obtenue;
      if (!dans(au)) continue;
      ajouter({
        origine: 'certification', certId: c.id, suivieId: null, empId: e.id, formation: c.f, intitule: fm!.nom, organisme: fm!.organisme ?? '',
        du, au, duree: s ? heuresSession(s, fm) : fm!.dureeHeures ?? null, resultat: resultatCert(fm), interim: e.typeContrat === 'interim',
      });
    }
  }
  for (const x of suiviesEnVigueur(d.ds)) {
    const e = d.emp(x.empId), fm = x.f ? d.fm(x.f) : undefined;
    if (!nominatif(e) || !marqueePasseport(fm) || !dans(x.au) || suivieCertifiee(e, x)) continue;
    ajouter({
      origine: 'suivie', certId: null, suivieId: x.id, empId: e.id, formation: x.f!, intitule: fm!.nom, organisme: x.organisme || fm!.organisme || '',
      du: x.du, au: x.au, duree: heuresSuivie(d, x), resultat: 'Formation suivie', interim: e.typeContrat === 'interim',
    });
  }
  const nom = (id: number) => d.emp(id)?.nom ?? '';
  return out.sort((a, b) => a.au.localeCompare(b.au) || nom(a.empId).localeCompare(nom(b.empId), 'fr') || a.cle.localeCompare(b.cle));
}

/** Période proposée : l'année civile en cours jusqu'au jour. */
export const periodeParDefaut = (ti: ISODate): PeriodePasseport => ({ du: `${ti.slice(0, 4)}-01-01`, au: ti });

/** Période saisie contrôlée : deux dates valides, dans l'ordre, sur 10 ans au plus ; sinon le message d'erreur. */
export function controlerPeriode(du: unknown, au: unknown): { periode: PeriodePasseport | null; erreur: string | null } {
  if (typeof du !== 'string' || typeof au !== 'string' || !isValidDate(du) || !isValidDate(au)) return { periode: null, erreur: 'Période invalide : deux dates attendues' };
  if (au < du) return { periode: null, erreur: 'Période invalide : la fin précède le début' };
  if (Number(au.slice(0, 4)) - Number(du.slice(0, 4)) > 10) return { periode: null, erreur: 'Période trop longue : 10 ans au plus' };
  return { periode: { du, au }, erreur: null };
}

// — Déclaration —

/** Lignes désignées par leurs clés (« cert:12 », « suivie:4 »), sans doublon ; null si l'une est inconnue ou mal formée. */
export function clesValides(v: unknown, max = 2000): { certs: number[]; suivies: number[] } | null {
  if (!Array.isArray(v) || !v.length || v.length > max) return null;
  const certs = new Set<number>(), suivies = new Set<number>();
  for (const x of v) {
    const m = typeof x === 'string' ? /^(cert|suivie):([1-9]\d{0,9})$/.exec(x) : null;
    if (!m) return null;
    (m[1] === 'cert' ? certs : suivies).add(Number(m[2]));
  }
  return { certs: [...certs], suivies: [...suivies] };
}

/** Jour de déclaration admis : une date valide, pas à venir. */
export function erreurDateDeclaration(le: unknown, ti: ISODate): string | null {
  if (typeof le !== 'string' || !isValidDate(le)) return 'Indiquez le jour de la déclaration sur la plateforme.';
  if (le > ti) return 'La déclaration ne peut pas être datée d’un jour à venir.';
  return null;
}

/** Déclaration d'une ligne, si elle en a une. */
export const declarationDe = (ds: { declarationsPasseport?: DeclarationPasseport[] }, cle: string): DeclarationPasseport | null =>
  (ds.declarationsPasseport ?? []).find(x => cleLigne(x) === cle) ?? null;

/**
 * Rappel ajouté au message d'une correction ou d'une annulation (certification, formation suivie) d'une ligne déjà
 * déclarée : Cursus ne corrige pas la plateforme. Vide si la ligne n'est pas déclarée.
 */
export function rappelDeclaration(ds: { declarationsPasseport?: DeclarationPasseport[] }, cle: string): string {
  const x = declarationDe(ds, cle);
  return x ? `déjà déclarée au Passeport de prévention le ${fmtIso(x.declareLe)} : à corriger aussi sur la plateforme` : '';
}

// — Export (gabarit réglable) —

/** Colonnes du gabarit, dans leur ordre ; `defaut` : cochées tant que l'administrateur RH ne les a pas réglées. */
export const COLONNES_PASSEPORT: readonly { id: ColonnePasseport; label: string; defaut: boolean; aide?: string }[] = [
  { id: 'nom', label: 'Nom', defaut: true },
  { id: 'prenom', label: 'Prénom', defaut: true, aide: 'premier mot du nom de la fiche' },
  { id: 'naissance', label: 'Date de naissance', defaut: true },
  { id: 'matricule', label: 'Matricule de paie', defaut: true },
  { id: 'nir', label: 'NIR', defaut: false, aide: 'toujours vide : Cursus ne le détient pas, rapprochement par le matricule dans Sage' },
  { id: 'code', label: 'Code de la formation', defaut: false },
  { id: 'intitule', label: 'Intitulé de la formation', defaut: true },
  { id: 'organisme', label: 'Organisme de formation', defaut: true },
  { id: 'du', label: 'Du', defaut: true },
  { id: 'au', label: 'Au', defaut: true },
  { id: 'duree', label: 'Durée (heures)', defaut: true },
  { id: 'resultat', label: 'Résultat', defaut: true },
];
export const COLONNES_PASSEPORT_IDS: readonly ColonnePasseport[] = COLONNES_PASSEPORT.map(c => c.id);
export const COLONNES_PASSEPORT_DEFAUT: ColonnePasseport[] = COLONNES_PASSEPORT.filter(c => c.defaut).map(c => c.id);

/**
 * Prénom et nom d'une fiche « Prénom Nom » : le premier mot, puis le reste. Un prénom composé sans trait d'union
 * (« Jean Pierre Martin ») se coupe mal : à vérifier dans le fichier avant l'envoi.
 */
export function prenomNom(nom: string): { prenom: string; nom: string } {
  const mots = nom.trim().split(/\s+/);
  return mots.length < 2 ? { prenom: '', nom: mots[0] ?? '' } : { prenom: mots[0], nom: mots.slice(1).join(' ') };
}

const jma = (iso: ISODate | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '');
const heures = (n: number | null) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));

/**
 * Fichier de l'export : colonnes du gabarit (ordre de `COLONNES_PASSEPORT`), puis la mention du format. La date de
 * naissance vient de la fiche complète (`naissanceLe`, sinon vide) : l'export est produit par le serveur.
 */
export function exportPasseport(d: Domain, lignes: readonly LignePasseport[], colonnes: readonly ColonnePasseport[], p: PeriodePasseport): { fichier: string; head: string[]; rows: (string | number)[][] } {
  const cols = COLONNES_PASSEPORT.filter(c => colonnes.includes(c.id));
  const valeur = (c: ColonnePasseport, l: LignePasseport, e: Employe | undefined): string => {
    const pn = prenomNom(e?.nom ?? '');
    switch (c) {
      case 'nom': return pn.nom;
      case 'prenom': return pn.prenom;
      case 'naissance': return jma(e?.naissanceLe);
      case 'matricule': return e?.matriculePaie ?? '';
      case 'nir': return '';
      case 'code': return l.formation;
      case 'intitule': return l.intitule;
      case 'organisme': return l.organisme;
      case 'du': return jma(l.du);
      case 'au': return jma(l.au);
      case 'duree': return heures(l.duree);
      case 'resultat': return l.resultat;
    }
  };
  return {
    fichier: `passeport-prevention-${p.du}-${p.au}.csv`,
    head: [...cols.map(c => c.label), 'Mention'],
    rows: lignes.map(l => {
      const e = d.emp(l.empId);
      return [...cols.map(c => valeur(c.id, l, e)), MENTION_PASSEPORT];
    }),
  };
}

/** Matricule affiché à l'écran (matricule de paie, sinon celui de Cursus), pour repérer une fiche sans matricule de paie. */
export const matriculeLigne = (e: Pick<Employe, 'id' | 'matriculePaie'>) => matriculeAffiche(e);
/** « du 03/02/2026 au 04/02/2026 », ou le jour seul. */
export const plageLigne = (l: Pick<LignePasseport, 'du' | 'au'>) => (l.du === l.au ? fmtIso(l.au) : `${fmtIso(l.du)} – ${fmtIso(l.au)}`);
