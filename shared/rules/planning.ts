// Planning d'équipe (lot 12, chantier C5, t192) : génération des créneaux à partir des affectations au roulement, état
// effectif d'un créneau pour le planificateur et pour le salarié, délai de prévenance de la publication, garde-fous de la
// publication et des échanges. Contrôles légaux : shared/rules/planning-controles.ts ; cycles : shared/rules/cycles.ts ;
// actions : server/src/actions/planning.ts. Module désactivé par défaut (réglage `planningActif`), en attendant l'avis du CSE.
// - Génération (planning.generer, en brouillon) : chaque salarié affecté à un cycle de l'équipe reçoit, chaque jour de la
//   période où son affectation court et où il est sous contrat, le poste que le cycle prévoit pour son groupe (repos
//   compris). Jour férié chômé (shared/dates.ts, calendrier réglé) : repos, sauf dérogation au repos dominical de l'équipe
//   (travail en continu, suppléance), où le cycle continue. Un créneau déjà publié n'est jamais remplacé (on le modifie), ni
//   une correction manuelle en brouillon ; un brouillon généré l'est par la nouvelle génération.
// - Absences : jamais écrites sur le planning. Pour le planificateur seul (service RH, manager, suppléant « planning »), un
//   jour d'absence en vigueur (validée ou signalée) rend le créneau « absent », sans nature (`etatPourPlanificateur`) ; le
//   salarié et ses collègues ne le voient jamais (jour vide, comme un repos).
// - Publication (planning.publier) : versionnée par équipe ; délai de prévenance compté depuis `communiqueLe` (envoi effectif
//   de l'e-mail, jamais la notification push retardée par la plage de silence), règle de `prevenance` des astreintes ; sous
//   le délai, motif des circonstances exceptionnelles exigé, gardé sur le créneau et jamais journalisé. Une semaine dont la
//   feuille du salarié est validée n'est jamais publiée ; un jour passé non plus (il se corrige sur la feuille de temps).
// - Échange (planning.echange.*) : A propose, B accepte, le manager des deux (ou son suppléant « planning ») valide ; expiré
//   dès que l'un des créneaux commence avant la décision.
import { addD, days, isFerie, isValidDate, mondayOf, parse } from '../dates.ts';
import { fmtIso, plural } from '../format.ts';
import type { Absence, Employe, FeuilleTemps, Horaire, HoraireFige, ISODate } from '../types.ts';
import type { BesoinPoste, Creneau, Cycle, EchangePoste, Roulement, StatutEchange } from '../types-planning.ts';
import { absenceBloque, jourHorsContrat } from './absences.ts';
import { prevenance } from './astreintes.ts';
import { cycleDe, horaireDuCycle } from './cycles.ts';
import { horaireDe } from './horaires.ts';
import { instantParis } from './planning-controles.ts';

/** Période générée ou publiée d'un seul tenant : 12 semaines au plus. */
export const SEMAINES_MAX = 12;
/** Motif des circonstances exceptionnelles, des alertes acceptées, d'une annulation, d'un refus : 500 caractères au plus. */
export const MOTIF_PLANNING_MAX = 500;

/** Statuts d'un échange encore ouvert (à accepter, à valider). */
export const ECHANGE_OUVERT: readonly StatutEchange[] = ['propose', 'accepte'];
export const STATUT_ECHANGE: Record<StatutEchange, string> = {
  propose: 'Proposé au collègue', accepte: 'Accepté, à valider', valide: 'Validé', refuse: 'Refusé', annule: 'Annulé', expire: 'Expiré',
};

/** Créneau d'un salarié (ni « à pourvoir »). */
export const nominatif = (c: Pick<Creneau, 'empId'>): c is Creneau & { empId: number } => c.empId != null;
/** Créneau qui compte encore : ni remplacé, ni annulé. */
export const creneauActif = (c: Pick<Creneau, 'statut'>) => c.statut === 'brouillon' || c.statut === 'publie';

/** Horaire figé d'un créneau (null : repos). */
export const horaireDuCreneau = (c: Pick<Creneau, 'horaire' | 'debut' | 'fin' | 'pause'>): HoraireFige | null =>
  (c.horaire && c.debut && c.fin ? { code: c.horaire, debut: c.debut, fin: c.fin, pause: c.pause ?? 0 } : null);
/** Colonnes figées d'un horaire du référentiel sur un créneau (repos : tout à null). */
export const figerHoraire = (h: Pick<Horaire, 'code' | 'debut' | 'fin' | 'pause'> | null) =>
  (h ? { horaire: h.code, debut: h.debut, fin: h.fin, pause: h.pause } : { horaire: null, debut: null, fin: null, pause: 0 });

/** Période valide : dates, début au plus tard à la fin, 12 semaines au plus. Message, ou null. */
export function refusPeriode(du: unknown, au: unknown): string | null {
  if (typeof du !== 'string' || typeof au !== 'string' || !isValidDate(du) || !isValidDate(au)) return 'Période invalide : indiquez le premier et le dernier jour';
  if (au < du) return 'La fin de la période précède son début';
  if (days(parse(du), parse(au)) + 1 > SEMAINES_MAX * 7) return `Période limitée à ${SEMAINES_MAX} semaines`;
  return null;
}

/**
 * Créneaux en vigueur pour le planificateur : un par salarié et par jour (le brouillon qui remplacera une version publiée
 * passe devant elle), « à pourvoir » compris ; ni remplacés, ni annulés.
 */
export function creneauxPlanificateur(creneaux: readonly Creneau[]): Creneau[] {
  const remplaces = new Set(creneaux.filter(c => c.statut === 'brouillon' && c.remplaceId).map(c => c.remplaceId!));
  return creneaux.filter(c => creneauActif(c) && !remplaces.has(c.id));
}
/** Créneaux publiés en vigueur (ce qu'a reçu le salarié) : la version publiée, pas le brouillon qui la remplacera. */
export const creneauxPublies = (creneaux: readonly Creneau[]) => creneaux.filter(c => c.statut === 'publie');

/** Absence en vigueur du salarié ce jour-là (validée ou signalée), sans sa nature. */
export const absentLe = (absences: readonly Pick<Absence, 'empId' | 'du' | 'au' | 'statut'>[], empId: number, jour: ISODate) =>
  absences.some(a => a.empId === empId && absenceBloque(a) && a.du <= jour && jour <= a.au);

/**
 * État d'un créneau pour le planificateur : « absent » un jour d'absence en vigueur (sans la nature, jamais pour le
 * salarié ni ses collègues), sinon « repos », « poste », « à pourvoir ».
 */
export function etatPourPlanificateur(c: Pick<Creneau, 'empId' | 'jour' | 'horaire'>, absences: readonly Pick<Absence, 'empId' | 'du' | 'au' | 'statut'>[]): 'absent' | 'repos' | 'poste' | 'a_pourvoir' {
  if (c.empId == null) return 'a_pourvoir';
  if (absentLe(absences, c.empId, c.jour)) return 'absent';
  return c.horaire ? 'poste' : 'repos';
}

// — Génération —

/** Créneau proposé par la génération : salarié, jour, équipe, poste figé (repos : horaire null), jour férié chômé. */
export interface CreneauGenere {
  empId: number; jour: ISODate; equipe: string; horaire: string | null; debut: string | null; fin: string | null; pause: number; ferie: boolean;
}
export interface Generation {
  creneaux: CreneauGenere[];
  /** Salariés affectés à un cycle archivé, à un groupe inconnu ou à un horaire archivé : rien n'est généré pour eux ce jour-là. */
  ignores: { empId: number; jour: ISODate; raison: string }[];
}

/**
 * Créneaux d'une équipe du `du` au `au` d'après les affectations au roulement (`roulements` dont l'équipe figée est
 * `equipe`), les cycles et les horaires du référentiel. `derogation` : dérogation au repos dominical de l'équipe (le cycle
 * continue les jours fériés). Sortie du contrat : rien.
 */
export function genererCreneaux(x: {
  equipe: string; du: ISODate; au: ISODate; roulements: readonly Roulement[]; cycles: readonly Cycle[]; horaires: readonly Horaire[];
  employes: readonly Pick<Employe, 'id' | 'entree' | 'fin' | 'typeContrat'>[]; derogation: boolean;
}): Generation {
  const out: Generation = { creneaux: [], ignores: [] };
  const employes = new Map(x.employes.map(e => [e.id, e]));
  for (const r of x.roulements.filter(r => r.equipe === x.equipe)) {
    const e = employes.get(r.empId), c = cycleDe(x.cycles, r.cycle);
    if (!e) continue;
    for (let jour = r.du > x.du ? r.du : x.du; jour <= x.au && (!r.au || jour <= r.au); jour = addD(jour, 1)) {
      if (jourHorsContrat(e, jour)) continue;
      if (!c || c.archive) { out.ignores.push({ empId: e.id, jour, raison: `cycle ${r.cycle} archivé ou inconnu` }); continue; }
      if (!c.groupes.some(g => g.code === r.groupe)) { out.ignores.push({ empId: e.id, jour, raison: `groupe ${r.groupe} inconnu du cycle ${c.code}` }); continue; }
      const code = horaireDuCycle(c, r.groupe, jour);
      const h = code ? horaireDe({ horaires: [...x.horaires] }, code) : null;
      if (code && (!h || h.archive)) { out.ignores.push({ empId: e.id, jour, raison: `horaire ${code} archivé ou inconnu` }); continue; }
      const ferie = isFerie(jour);
      const poste = ferie && !x.derogation ? null : h;
      out.creneaux.push({ empId: e.id, jour, equipe: x.equipe, ...figerHoraire(poste), ferie });
    }
  }
  return out;
}

/**
 * Sort d'un créneau généré face à l'existant du même salarié et du même jour : « inserer » (rien), « remplacer » (brouillon
 * généré, à mettre à jour), « garder » (publié, ou corrigé à la main en brouillon : la génération n'y touche pas).
 */
export function sortGenere(existant: Pick<Creneau, 'statut' | 'source'> | undefined): 'inserer' | 'remplacer' | 'garder' {
  if (!existant) return 'inserer';
  return existant.statut === 'brouillon' && existant.source === 'cycle' ? 'remplacer' : 'garder';
}

// — Publication —

/** Délai de prévenance d'un créneau du jour `jour` communiqué le `communique` : jours, et délai réglé non tenu. */
export function prevenanceCreneau(jour: ISODate, communique: ISODate, delai: number): { jours: number; horsDelai: boolean } {
  // Règle des astreintes (shared/rules/astreintes.ts) : jours de date à date ; le jour franc des astreintes ne vaut pas ici.
  const p = prevenance(jour, communique, { astreinteDelaiPrevenance: delai });
  return { jours: p.jours, horsDelai: p.court };
}

/** Texte de l'alerte d'un délai court, qui demande le motif. */
export const delaiCourtPlanning = (n: number, premier: ISODate, delai: number) =>
  `${plural(n, 'créneau communiqué', 'créneaux communiqués')} moins de ${delai} jours avant leur date (dès le ${fmtIso(premier)}) : indiquez les circonstances exceptionnelles qui le justifient (délai de prévenance)`;

/**
 * Semaines verrouillées d'une publication : un créneau dont la feuille de la semaine du salarié est validée (le réalisé fait
 * foi), ou un jour passé (corrigé sur la feuille de temps). Messages, vides si la publication est permise.
 */
export function refusPublication(creneaux: readonly Pick<Creneau, 'empId' | 'jour'>[], feuilles: readonly Pick<FeuilleTemps, 'empId' | 'week' | 'statut'>[], ti: ISODate, nom: (id: number) => string): string[] {
  const out: string[] = [];
  const validees = new Set(feuilles.filter(f => f.statut === 'validee').map(f => `${f.empId}|${f.week}`));
  const passes = creneaux.filter(c => c.jour < ti);
  if (passes.length) out.push(`${plural(passes.length, 'créneau passé', 'créneaux passés')} (dès le ${fmtIso(passes.map(c => c.jour).sort()[0])}) : un jour passé se corrige sur la feuille de temps`);
  const verrou = [...new Set(creneaux.filter(c => c.empId != null && validees.has(`${c.empId}|${mondayOf(c.jour)}`)).map(c => `${nom(c.empId!)} (semaine du ${fmtIso(mondayOf(c.jour))})`))];
  if (verrou.length) out.push(`Feuille de temps déjà validée : ${verrou.join(', ')} — une semaine validée n’est jamais publiée`);
  return out;
}

/** Instant de début d'un créneau (minutes réelles, heure de Paris) ; un repos : minuit du jour. */
export const debutCreneau = (c: Pick<Creneau, 'jour' | 'debut'>) => instantParis(c.jour, c.debut ?? '00:00');

// — Échanges —

/**
 * Échange expiré à l'instant `maintenant` (minutes réelles) : ouvert, et l'un de ses créneaux a commencé. Créneau introuvable
 * (sorti de la fenêtre de lecture : il est passé) : expiré.
 */
export function echangeExpire(e: Pick<EchangePoste, 'statut' | 'creneauDemandeur' | 'creneauPartenaire'>, creneaux: ReadonlyMap<number, Pick<Creneau, 'jour' | 'debut'>>, maintenant: number): boolean {
  if (!ECHANGE_OUVERT.includes(e.statut)) return false;
  const ids = [e.creneauDemandeur, ...(e.creneauPartenaire ? [e.creneauPartenaire] : [])];
  return ids.some(id => { const c = creneaux.get(id); return !c || debutCreneau(c) <= maintenant; });
}

/**
 * Nouveaux postes des deux salariés après un échange (`b` null : cession du créneau `a` au partenaire). Clé « empId|jour »,
 * valeur : le créneau dont il prend l'horaire (null : repos). Refus si l'un travaille déjà le jour qu'il reçoit.
 */
export function postesApresEchange(a: Creneau & { empId: number }, b: (Creneau & { empId: number }) | null, partenaireId: number,
  actifs: readonly Creneau[]): { postes: Map<string, Creneau | null>; refus: string | null } {
  const postes = new Map<string, Creneau | null>();
  const travaille = (empId: number, jour: ISODate, sauf: number | null) => actifs.some(c => c.empId === empId && c.jour === jour && c.horaire && c.id !== sauf);
  if (!b) {
    if (travaille(partenaireId, a.jour, null)) return { postes, refus: `Le collègue travaille déjà le ${fmtIso(a.jour)} : la cession lui donnerait deux postes` };
    postes.set(`${a.empId}|${a.jour}`, null);
    postes.set(`${partenaireId}|${a.jour}`, a);
    return { postes, refus: null };
  }
  if (a.jour === b.jour) {
    postes.set(`${a.empId}|${a.jour}`, b);
    postes.set(`${b.empId}|${b.jour}`, a);
    return { postes, refus: null };
  }
  if (travaille(b.empId, a.jour, null)) return { postes, refus: `Le collègue travaille déjà le ${fmtIso(a.jour)}` };
  if (travaille(a.empId, b.jour, null)) return { postes, refus: `Vous travaillez déjà le ${fmtIso(b.jour)}` };
  postes.set(`${a.empId}|${a.jour}`, null);
  postes.set(`${b.empId}|${a.jour}`, a);
  postes.set(`${b.empId}|${b.jour}`, null);
  postes.set(`${a.empId}|${b.jour}`, b);
  return { postes, refus: null };
}

// — Besoins par poste —

export interface ErreursBesoin { equipe?: string; horaire?: string; jours?: string; effectifMin?: string; du?: string; au?: string; exigences?: string }
/**
 * Besoin par poste d'une équipe : équipe et horaire en vigueur, jours de la semaine (0 = lundi … 6 = dimanche, au moins un),
 * effectif minimal de 1 à 99, poste du référentiel ou activité (facultatifs), exigences propres connues du référentiel,
 * période (`au` facultatif, après `du`).
 */
export function controlerBesoin(p: Record<string, unknown>, r: { equipes: readonly { nom: string }[]; horaires: readonly Horaire[]; postes: readonly { id: number }[];
  formations: readonly { id: string }[]; habilitations: readonly { id: string }[] }, existant: BesoinPoste | null):
  { erreurs: ErreursBesoin; valeurs: Omit<BesoinPoste, 'id' | 'archive'> | null } {
  const erreurs: ErreursBesoin = {};
  const v = <K extends keyof BesoinPoste>(k: K): unknown => (p[k] !== undefined ? p[k] : existant?.[k]);
  const equipe = String(v('equipe') ?? '');
  if (!r.equipes.some(q => q.nom === equipe)) erreurs.equipe = 'Équipe inconnue';
  const horaire = String(v('horaire') ?? '').trim().toUpperCase();
  if (!r.horaires.some(h => h.code === horaire && !h.archive)) erreurs.horaire = 'Horaire inconnu ou archivé';
  const joursRecus = v('jours');
  const jours = Array.isArray(joursRecus) ? [...new Set(joursRecus.map(Number))].sort() : [];
  if (!jours.length || jours.some(j => !Number.isInteger(j) || j < 0 || j > 6)) erreurs.jours = 'Choisissez au moins un jour de la semaine';
  const effectifMin = Number(v('effectifMin'));
  if (!Number.isInteger(effectifMin) || effectifMin < 1 || effectifMin > 99) erreurs.effectifMin = 'Effectif minimal : un nombre entier de 1 à 99';
  const posteId = v('posteId') == null || v('posteId') === '' ? null : Number(v('posteId'));
  if (posteId != null && !r.postes.some(x => x.id === posteId)) erreurs.exigences = 'Poste inconnu';
  const activite = v('activite') == null ? null : String(v('activite')).trim().slice(0, 60) || null;
  const ex = (v('exigences') ?? { formations: [], habilitations: [] }) as { formations?: unknown; habilitations?: unknown };
  const formations = Array.isArray(ex.formations) ? [...new Set(ex.formations.map(String))] : [];
  const habilitations = Array.isArray(ex.habilitations) ? [...new Set(ex.habilitations.map(String))] : [];
  if (formations.some(f => !r.formations.some(x => x.id === f)) || habilitations.some(h => !r.habilitations.some(x => x.id === h))) erreurs.exigences = 'Formation ou habilitation inconnue';
  const du = String(v('du') ?? ''), auRecu = v('au'), au = auRecu == null || auRecu === '' ? null : String(auRecu);
  if (!isValidDate(du)) erreurs.du = 'Date de début invalide';
  if (au != null && (!isValidDate(au) || au < du)) erreurs.au = 'Date de fin invalide, ou avant le début';
  return Object.keys(erreurs).length
    ? { erreurs, valeurs: null }
    : { erreurs, valeurs: { equipe, horaire, jours, effectifMin, posteId, activite, exigences: { formations, habilitations }, du, au } };
}

/** Besoins en vigueur d'une équipe le jour `jour` pour l'horaire `horaire` (exigences propres du créneau). */
export function besoinsDuJour(besoins: readonly BesoinPoste[] | undefined, equipe: string | null, horaire: string | null, jour: ISODate): BesoinPoste[] {
  if (!equipe || !horaire) return [];
  const j = (parse(jour).getDay() + 6) % 7;
  return (besoins ?? []).filter(b => !b.archive && b.equipe === equipe && b.horaire === horaire && b.jours.includes(j) && b.du <= jour && (!b.au || jour <= b.au));
}

// — Affectations au roulement —

export interface ErreursRoulement { cycle?: string; groupe?: string; du?: string; au?: string; general?: string }
/**
 * Affectation d'un salarié à un cycle : cycle en vigueur, groupe du cycle, période dans le contrat (`au` facultatif), sans
 * chevauchement avec une autre affectation du salarié.
 */
export function controlerRoulement(p: { cycle?: unknown; groupe?: unknown; du?: unknown; au?: unknown }, e: Pick<Employe, 'id' | 'entree' | 'fin' | 'typeContrat'>,
  cycles: readonly Cycle[], roulements: readonly Roulement[]): { erreurs: ErreursRoulement; valeurs: Pick<Roulement, 'cycle' | 'groupe' | 'du' | 'au'> | null } {
  const erreurs: ErreursRoulement = {};
  const cycle = String(p.cycle ?? '').trim().toUpperCase(), c = cycleDe(cycles, cycle);
  if (!c || c.archive) erreurs.cycle = 'Cycle inconnu ou archivé';
  const groupe = String(p.groupe ?? '').trim().toUpperCase();
  if (c && !c.groupes.some(g => g.code === groupe)) erreurs.groupe = `Groupe inconnu du cycle ${c.code} (${c.groupes.map(g => g.code).join(', ')})`;
  const du = String(p.du ?? ''), au = p.au == null || p.au === '' ? null : String(p.au);
  if (!isValidDate(du)) erreurs.du = 'Date de début invalide';
  else if (jourHorsContrat(e, du)) erreurs.du = `Début hors du contrat (${jourHorsContrat(e, du)})`;
  if (au != null && (!isValidDate(au) || au < du)) erreurs.au = 'Date de fin invalide, ou avant le début';
  if (!Object.keys(erreurs).length) {
    const autre = roulements.find(r => r.empId === e.id && r.du <= (au ?? '9999-12-31') && du <= (r.au ?? '9999-12-31'));
    if (autre) erreurs.general = `Déjà affecté au cycle ${autre.cycle} (groupe ${autre.groupe}) du ${fmtIso(autre.du)}${autre.au ? ` au ${fmtIso(autre.au)}` : ''} : terminez cette affectation d’abord`;
  }
  return Object.keys(erreurs).length ? { erreurs, valeurs: null } : { erreurs, valeurs: { cycle, groupe, du, au } };
}
