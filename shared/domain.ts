// Règles métier de Cursus : conformité des certifications et habilitations,
// formalités de voyage, Go / No Go des chantiers Keystone.
// Fonctions pures d'un instantané de données — utilisées par le client pour
// l'affichage et par le serveur pour valider les actions et les intégrations.
import {
  AVIS_MEDICAL, CERT_LABEL, CLS, DOC_LABEL, GNG_CODE, HAB_CLS, HAB_LABEL, MED_LABEL, MED_VALIDITE, MISSION_LONGUE_JOURS, RANK, SECU_RULES, SESSION_PASSEE, STATUTS,
  TEMPS_TRAVAIL, TYPES_CONTRAT, VACCINS, VISA_RULES, secuDe, type CodeMotif, type HabKey, type HabMesureAction, type StatusKey,
} from './constants.ts';
import { addD, addMonths, days, isFerie, iso, parse, weekday } from './dates.ts';
import { cap, fmt, fmtShort } from './format.ts';
import { absenceActive, absenceBloque, borneContrat, periodeTexte } from './rules/absences.ts';
import { actifs, habSuivie } from './rules/referentiels.ts';
import { identifiantKeystone } from './rules/matricules.ts';
import { echeancesContrat, etatAutorisation, present, SITUATION_A_REGULARISER } from './rules/contrats.ts';
import { restrictionEnVigueur } from './rules/sante.ts';
import type {
  AvisMedical, Certification, Chantier, Dataset, DemandeVisite, Destination, Employe, FormaliteManquante, Formation, HabTitre, HabType, ISODate,
  Restriction, Session, Statut, TempsTravail, TripStatus, TypeContrat, VaccinId, Voyage,
} from './types.ts';

export interface CertInfo extends Certification {
  fm: Formation; obt: Date; exp: Date; d: number; key: StatusKey; pct: number;
  /** Session à venir où le recyclage est planifié. */
  session: Session | null;
  /** Session passée, pas encore clôturée : le recyclage n'est plus planifié, il attend la clôture (présence, résultat). */
  sessionPassee: Session | null;
  /** Certification remplacée par un recyclage : date d'obtention de la suivante (null = en vigueur). */
  remplacee: Date | null;
}
/**
 * Aptitude médicale d'un collaborateur : valide (visite de moins de 24 mois, sans avis d'inaptitude), échéance,
 * avis et restrictions de la dernière visite, demande de visite en cours.
 */
export interface MedInfo {
  ok: boolean; exp: Date | null; d: number | null; text: string;
  /** Date de la dernière visite ; null : aucune visite enregistrée, ou verdict seul. */
  visite: Date | null;
  /** Avis de la dernière visite (null : aucune visite) et ses restrictions, en vigueur ou non (vue manager : en vigueur). */
  avis: AvisMedical | null;
  restrictions: Restriction[];
  /** Demande de visite en cours (service RH et intéressé). */
  demande: DemandeVisite | null;
  /** Vue manager (ou profil restreint) : verdict seul, sans date de visite ni demande. */
  verdictSeul: boolean;
}
export interface PrereqCheck { type: 'cert' | 'med'; f: string | null; certId: number | null; label: string; ok: boolean; due: boolean; exp: Date | null; text: string }
export interface HabInfo extends HabTitre {
  hm: HabType; checks: PrereqCheck[]; failing: PrereqCheck[]; prereqOk: boolean; exp: Date | null; d: number | null; key: HabKey; note: string;
  /** Date de la suspension ou du retrait en cours. */
  mesureLe: Date | null;
}
export interface EmpX extends Omit<Employe, 'certs' | 'habs'> {
  /** Certifications en vigueur (une par formation), selon le filtre « réglementaires uniquement ». */
  certs: CertInfo[];
  /** Certifications en vigueur de toutes les formations, y compris hors filtre « réglementaires uniquement ». */
  rawCerts: CertInfo[];
  /** Certifications remplacées par un recyclage, conservées comme historique (toutes formations, plus récentes d'abord). */
  anciennes: CertInfo[];
  med: MedInfo;
  habs: HabInfo[];
  worst: StatusKey;
  next: { exp: Date; d: number } | null;
}

/** Intention d'interface déclenchée par une action proposée (le client l'exécute). */
export type UiIntent =
  | { type: 'openHab'; empId: number; h: string; mode: 'deliver' | 'renew' | 'new' }
  | { type: 'openPlan'; empId: number; certId: number }
  | { type: 'goFormation'; f: string }
  | { type: 'medical'; empId: number }
  | { type: 'openFormalite'; empId: number; kind: FormaliteKind; dest?: string; v?: VaccinId }
  | { type: 'openCloture'; sessionId: number }
  // Échéances du contrat (shared/rules/contrats.ts) : fiche (période d'essai), sortie, titre de séjour.
  | { type: 'openContrat'; empId: number; quoi: 'fiche' | 'sortie' | 'titre' };
export type FormaliteKind = 'passeport' | 'visa' | 'vaccin';
export interface Proposal { label: string; intent: UiIntent }

/** Pièce du dossier voyage : formalité du salarié, ou formalité de détachement tenue par le service RH (`voyage.detachement`). */
export type TripItemKind = FormaliteKind | 'detachement' | 'information';
export interface TripItem {
  k: TripItemKind; label: string; ok: boolean; mandatory: boolean; lapsed?: boolean; lead: number; text: string; short?: string;
  fix?: { kind: FormaliteKind; dest?: string; v?: VaccinId }; late: boolean; statut: string; cls: string;
}
export interface Readiness { dest: Destination; dep: Date; ret: Date; toGo: number; items: TripItem[]; todo: number; status: TripStatus }
export interface TripX extends Voyage { emp: Employe; r: Readiness }

export interface EchItem {
  kind: 'cert' | 'hab' | 'trip' | 'med' | 'contrat'; kindLabel: string; label: string; emp: EmpX; exp: Date; d: number; key: StatusKey;
  statut: string; cls: string; planned: boolean; plannedLabel: string; action: Proposal | null;
  /** Échéance sans date connue (aucune visite médicale enregistrée) : classée au jour, parmi les dépassées. */
  sansDate?: boolean;
}

export type GngStatus = 'go' | 'reserve' | 'nogo';
/**
 * Motif d'un verdict : `detailed` s'affiche au service RH (écran Chantiers) et part à Keystone en partage détaillé,
 * sauf `transmis` : libellé neutre envoyé à sa place (aptitude médicale, dont le détail reste au service RH).
 */
export interface GngReason { level: 'reserve' | 'nogo'; code: CodeMotif; minimal: string; detailed: string; transmis?: string }
export interface ChantierEval { c: Chantier; res: { e: EmpX; status: GngStatus; reasons: GngReason[] }[]; status: GngStatus }
/** Période de présence d'une ressource sur un chantier (dates incluses). */
export interface Presence { du: ISODate; au: ISODate }
/** Pièces du dossier voyage qui relèvent du détachement, les autres des formalités de voyage (motifs distincts du Go / No Go). */
const PIECES_DETACHEMENT: readonly TripItemKind[] = ['detachement', 'information'];
/** Seul libellé du motif APTITUDE (réserve) transmis à Keystone en partage détaillé, quelle qu'en soit la cause. */
const APTITUDE_A_VERIFIER = 'Aptitude médicale à vérifier avec le service RH';

/** Lecture du contrat d'un collaborateur : statut, nature du contrat, organisation du temps. */
export interface ContratX {
  statut: Statut;
  typeContrat: TypeContrat;
  temps: TempsTravail;
  /** Organisation du temps, avec sa durée (« Forfait annuel en jours · 218 j »). */
  label: string;
  /** Libellé complet : « CDI · Ingénieur / cadre · Forfait annuel en jours · 218 j ». */
  libelle: string;
  /** Durée hebdomadaire de référence, en heures (35 par défaut pour les forfaits annuels). */
  base: number;
  /** Seuil hebdomadaire des heures supplémentaires ; null = pas de décompte hebdomadaire. */
  seuil: number | null;
  cadre: boolean;
  rtt: boolean;
  /** Forfait annuel en jours. */
  forfait: boolean;
  joursForfait: number;
  /** Forfait annuel en heures. */
  annuel: boolean;
  heuresAnnuelles: number;
  /** Forfait hebdomadaire en heures. */
  hebdo: boolean;
  partiel: boolean;
  dirigeant: boolean;
  interim: boolean;
  jourOff: number[];
}

const docKey = (d: number, h: number): StatusKey => d < 0 ? 'exp' : d <= h ? 'due' : 'ok';

/** Statut de conformité d'un titre : suspendu ou retiré compte comme expiré ; une demande en attente ne pénalise pas. */
const habStatus = (k: HabKey): StatusKey => k === 'susp' || k === 'retiree' ? 'exp' : k === 'pending' ? 'ok' : k;

/**
 * Titre détenu ou déjà demandé, qu'un collaborateur ne peut pas redemander. Un titre expiré ou retiré peut l'être, tant
 * qu'aucune demande de renouvellement ou de nouvelle délivrance n'a été acceptée (`demande` renseignée).
 */
export const habEnCours = (h: Pick<HabInfo, 'key' | 'demande'>) => h.key === 'retiree' || h.key === 'exp' ? !!h.demande : true;

/**
 * Titre expiré dont le renouvellement a été accepté par le service RH (`demande.accepter`) : il reste expiré (statut,
 * échéances, Go / No Go) mais compte « en attente » de délivrance dans l'onglet Habilitations.
 */
export const renouvellementDemande = (h: Pick<HabInfo, 'key' | 'demande' | 'delivree'>) => h.key === 'exp' && !!h.delivree && !!h.demande;

/** Session ouverte : ni clôturée, ni annulée (inscriptions, planification, clôture). */
export const sessionActive = (s: Pick<Session, 'statut'>) => s.statut !== 'Clôturée' && s.statut !== 'Annulée';

/** Ordre chronologique inverse : date d'obtention, puis ordre d'enregistrement. */
const plusRecente = (a: Pick<Certification, 'id' | 'obtenue'>, b: Pick<Certification, 'id' | 'obtenue'>) => b.obtenue.localeCompare(a.obtenue) || b.id - a.id;

/**
 * Certification en vigueur d'un collaborateur pour une formation : la plus récente. Un recyclage
 * enregistré remplace donc la précédente, qui reste au dossier comme historique. Seule la certification
 * en vigueur compte pour le statut, les échéances, les prérequis et le Go / No Go.
 */
export function certEnVigueur<T extends Pick<Certification, 'id' | 'f' | 'obtenue'>>(certs: readonly T[], f: string): T | null {
  return certs.filter(c => c.f === f).sort(plusRecente)[0] ?? null;
}

export class Domain {
  ds: Dataset;
  today: Date;
  ti: ISODate;

  constructor(ds: Dataset) {
    this.ds = ds;
    this.ti = ds.today;
    this.today = parse(ds.today);
  }

  get year() { return this.today.getFullYear(); }

  // — Référentiels —
  fm(id: string): Formation { return this.ds.referentiels.formations.find(f => f.id === id)!; }
  hm(id: string): HabType { return this.ds.referentiels.habilitations.find(h => h.id === id)!; }
  destOf(code: string): Destination | undefined { return this.ds.referentiels.destinations.find(d => d.code === code); }
  projet(code: string): string { return this.ds.referentiels.projets.find(p => p.code === code)?.nom ?? code; }
  chantier(id: string): Chantier | undefined { return this.ds.referentiels.chantiers.find(c => c.id === id); }
  emp(id: number): Employe | undefined { return this.ds.employes.find(e => e.id === id); }
  personName(id: number): string { return this.ds.annuaire.find(p => p.id === id)?.nom ?? this.emp(id)?.nom ?? `#${id}`; }
  session(id: number | null): Session | null { return id == null ? null : this.ds.sessions.find(s => s.id === id) ?? null; }
  get equipes(): string[] { return [...this.ds.referentiels.equipes].sort((a, b) => a.ordre - b.ordre).map(e => e.nom); }

  /** Manager valideur d'un collaborateur (0 = le service RH). */
  mgrOf(e: { id: number; equipe: string | null }): number {
    if (!e.equipe) return 0;
    const m = this.ds.referentiels.equipes.find(q => q.nom === e.equipe)?.managerId;
    return m && m !== e.id ? m : 0;
  }
  /** Valideur désigné par `mgrOf` : le manager, ou le service RH (plusieurs personnes, aucune n'est nommée). */
  mgrName(id: number): string { return id ? this.personName(id) : 'le service RH'; }
  /** Destinataire d'un envoi au valideur : « à Karim Haddad », « au service RH ». */
  mgrDest(id: number): string { return id ? `à ${this.personName(id)}` : 'au service RH'; }
  managers(): { id: number; equipe: string }[] {
    return this.ds.referentiels.equipes.filter(q => q.managerId).map(q => ({ id: q.managerId!, equipe: q.nom }));
  }
  /** Équipes encadrées par un collaborateur. */
  teamsOf(managerId: number | null): string[] {
    return managerId ? this.ds.referentiels.equipes.filter(q => q.managerId === managerId).map(q => q.nom) : [];
  }

  contratOf(e: Employe): ContratX {
    const t = TEMPS_TRAVAIL[e.temps] ?? TEMPS_TRAVAIL['35h'];
    const temps = TEMPS_TRAVAIL[e.temps] ? e.temps : '35h';
    const hebdo = temps === 'forfait_heures_hebdo', partiel = temps === 'partiel';
    const heures = e.heures ?? (partiel ? 28 : hebdo ? 38.5 : 35);
    const joursForfait = e.forfaitJours ?? 218, heuresAnnuelles = e.forfaitHeures ?? 1607;
    const base = partiel || hebdo ? heures : t.base ?? 35;
    const seuil = hebdo ? heures : t.seuil ?? null;
    const n = (v: number) => v.toLocaleString('fr-FR');
    const label = temps === 'forfait_jours' ? `${t.label} · ${n(joursForfait)} j`
      : temps === 'forfait_heures_annuel' ? `${t.label} · ${n(heuresAnnuelles)} h`
      : partiel || hebdo ? `${t.label} · ${n(heures)} h` : t.label;
    const statut = STATUTS[e.statut] ? e.statut : 'ouvrier';
    const typeContrat = TYPES_CONTRAT[e.typeContrat] ? e.typeContrat : 'cdi';
    return {
      statut, typeContrat, temps, label, libelle: `${TYPES_CONTRAT[typeContrat].label} · ${STATUTS[statut].label} · ${label}`,
      base, seuil, cadre: STATUTS[statut].cadre, rtt: temps === '39h_rtt', forfait: temps === 'forfait_jours', joursForfait,
      annuel: temps === 'forfait_heures_annuel', heuresAnnuelles, hebdo, partiel, dirigeant: temps === 'dirigeant',
      interim: typeContrat === 'interim', jourOff: partiel ? (e.jourOff || []) : [],
    };
  }
  /** Heures d'une journée de travail (pour convertir la récupération en jours). */
  dayH(e: Employe): number {
    const c = this.contratOf(e);
    if (c.forfait || c.dirigeant || c.annuel) return 7;
    return c.partiel ? c.base / Math.max(1, 5 - c.jourOff.length) : c.base / 5;
  }

  /** Absence en vigueur (validée ou signalée) un jour donné ; `inclPending` : demandes en attente comprises. */
  absOn(empId: number, s: ISODate, inclPending = false) {
    return this.ds.absences.find(a => a.empId === empId && a.du <= s && a.au >= s && (inclPending ? absenceActive(a) : absenceBloque(a)));
  }
  /**
   * Jours décomptés : week-ends et fériés exclus. Hors CP, les jours non travaillés du temps partiel
   * sont exclus ; pour les CP, ils le sont aussi en tête de période (le décompte part du premier jour
   * où le salarié aurait dû travailler), puis comptent comme jours ouvrés.
   */
  countDays(e: Employe, du: ISODate, au: ISODate, kind: string): number {
    return this.countedDays(e, du, au, kind).length;
  }
  /** Les jours décomptés eux-mêmes (même règle que `countDays`), pour imputer chacun sur sa période (CP). */
  countedDays(e: Employe, du: ISODate, au: ISODate, kind: string): ISODate[] {
    const out: ISODate[] = [];
    let started = false;
    const off = this.contratOf(e).jourOff;
    for (let s = du; s <= au; s = addD(s, 1)) {
      const wd = weekday(s);
      if (wd > 4 || isFerie(s)) continue;
      if (off.includes(wd) && (kind !== 'CP' || !started)) continue;
      started = true;
      out.push(s);
    }
    return out;
  }

  // — Formations —
  /** Sessions ouvertes à venir (aujourd'hui compris). */
  upcoming(formIds?: Set<string>): Session[] {
    return this.ds.sessions
      .filter(s => sessionActive(s) && s.date >= this.ti && (!formIds || formIds.has(s.formation)))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  /** Sessions passées qui attendent leur clôture, plus anciennes d'abord. */
  aCloturer(formIds?: Set<string>): Session[] {
    return this.ds.sessions
      .filter(s => sessionActive(s) && s.date < this.ti && (!formIds || formIds.has(s.formation)))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  /** Statut affiché : passée à clôturer, complète, ou statut enregistré (à confirmer, confirmée, clôturée, annulée). */
  sessionStatut(s: Session): string {
    if (!sessionActive(s)) return s.statut;
    return s.date < this.ti ? SESSION_PASSEE : s.inscrits >= s.places ? 'Complète' : s.statut;
  }
  /** Formations suivies : catalogue en vigueur (les archivées ne sont plus proposées ni suivies), réglementaires seules au besoin. */
  forms(onlyReg: boolean): Formation[] {
    const all = actifs(this.ds.referentiels.formations);
    return onlyReg ? all.filter(f => f.type === 'Réglementaire') : all;
  }

  certInfo(c: Certification, horizon: number, remplacee: Date | null = null): CertInfo {
    const fm = this.fm(c.f);
    const obt = parse(c.obtenue);
    const exp = addMonths(obt, fm.validite);
    const d = days(this.today, exp);
    const key: StatusKey = d < 0 ? 'exp' : d <= horizon ? 'due' : 'ok';
    const pct = Math.max(0, Math.min(100, Math.round(days(obt, this.today) / days(obt, exp) * 100)));
    // Une session clôturée ou annulée ne planifie plus rien ; une session passée attend sa clôture.
    const s = this.session(c.sessionId), active = s && sessionActive(s) ? s : null;
    const session = active && active.date >= this.ti ? active : null, sessionPassee = active && active.date < this.ti ? active : null;
    return { ...c, fm, obt, exp, d, key, pct, session, sessionPassee, remplacee };
  }

  /** Certifications d'un collaborateur : en vigueur (une par formation, dans l'ordre du dossier) et remplacées. */
  certsOf(e: Employe, horizon: number): { vigueur: CertInfo[]; anciennes: CertInfo[] } {
    const vigueur = [...new Set(e.certs.map(c => c.f))].map(f => this.certInfo(certEnVigueur(e.certs, f)!, horizon));
    const anciennes = e.certs
      .filter(c => !vigueur.some(v => v.id === c.id))
      .sort(plusRecente)
      .map(c => {
        // Remplacée par la certification suivante de la même formation.
        const suivante = e.certs.filter(x => x.f === c.f && plusRecente(x, c) < 0).sort(plusRecente).pop()!;
        return this.certInfo(c, horizon, parse(suivante.obtenue));
      });
    return { vigueur, anciennes };
  }

  /** Demande de visite médicale en cours d'un collaborateur. */
  demandeVisite(empId: number): DemandeVisite | null {
    return this.ds.demandesVisite.find(x => x.empId === empId && x.statut === 'demandee') ?? null;
  }

  /**
   * Aptitude médicale : visite de moins de 24 mois, sans avis d'inaptitude. Un avis avec restrictions laisse
   * l'aptitude valide : le service RH suspend les habilitations incompatibles (`medical.avis`).
   */
  medInfo(e: Employe): MedInfo {
    if (!e.visite && e.aptitude) {
      // Vue manager et profils restreints de l'espace RH : verdict et restrictions en vigueur, jamais la date de la
      // visite ni la demande.
      const a = e.aptitude, avis = a.avis ?? null;
      const text = avis === 'inapte' ? 'Inapte — avis du médecin du travail'
        : !a.ok ? 'Aptitude médicale non valide — visite à programmer par le service RH'
        : avis === 'restrictions' ? 'Apte avec restrictions — avis du médecin du travail' : 'Aptitude médicale valide';
      return { ok: a.ok, exp: null, d: null, text, visite: null, avis, restrictions: a.restrictions ?? [], demande: null, verdictSeul: true };
    }
    const demande = this.demandeVisite(e.id), demandee = demande ? `visite demandée le ${fmt(parse(demande.le))}` : 'visite à programmer';
    if (!e.visite) return { ok: false, exp: null, d: null, text: `Visite médicale non renseignée — ${demandee}`, visite: null, avis: null, restrictions: [], demande, verdictSeul: false };
    const date = parse(e.visite), exp = addMonths(date, MED_VALIDITE), d = days(this.today, exp);
    // Visite saisie avant l'enregistrement des avis : apte.
    const avis = e.avis ?? 'apte', inapte = avis === 'inapte';
    const suite = demande ? ` · ${demandee}` : '';
    const text = inapte ? `Inapte — avis du médecin du travail du ${fmt(date)}${suite}`
      : d >= 0 ? `Visite du ${fmt(date)} · ${avis === 'restrictions' ? 'apte avec restrictions, ' : ''}aptitude valide jusqu’au ${fmt(exp)}${suite}`
      : `Aptitude échue le ${fmt(exp)} — ${demandee}`;
    return { ok: d >= 0 && !inapte, exp, d, text, visite: date, avis, restrictions: avis === 'restrictions' ? e.restrictions ?? [] : [], demande, verdictSeul: false };
  }

  /** Statut de l'aptitude dans la conformité : non valide (inapte, échue, aucune visite), ou à renouveler sous l'horizon d'alerte. */
  medKey(med: MedInfo, horizon: number): StatusKey {
    return !med.ok ? 'exp' : med.d != null && med.d <= horizon ? 'due' : 'ok';
  }

  habInfo(h: Pick<HabTitre, 'h'> & Partial<HabTitre>, rawCerts: CertInfo[], med: MedInfo, horizon: number): HabInfo {
    const hm = this.hm(h.h);
    const checks: PrereqCheck[] = hm.prereqs.map(f => {
      const fm = this.fm(f);
      const c = certEnVigueur(rawCerts, f);
      const ok = !!c && c.key !== 'exp';
      return {
        type: 'cert', f, certId: c ? c.id : null, label: fm.court, ok, due: ok && c.key === 'due', exp: c ? c.exp : null,
        text: c ? (ok ? `Valide jusqu’au ${fmt(c.exp)}` : `Expirée le ${fmt(c.exp)}`) : 'Formation non suivie',
      };
    });
    if (hm.medical) checks.push({ type: 'med', f: null, certId: null, label: 'Aptitude médicale', ok: med.ok, due: false, exp: med.exp, text: med.text });
    const failing = checks.filter(c => !c.ok), dueChecks = checks.filter(c => c.due), prereqOk = failing.length === 0;
    // Une suspension ou un retrait décidé par l'employeur prime sur l'échéance et les prérequis.
    const mesure = h.delivree && h.mesure ? h.mesure : null;
    const mesureLe = mesure && h.mesureDate ? parse(h.mesureDate) : null;
    let exp: Date | null = null, d: number | null = null, key: HabKey = 'pending';
    if (h.delivree) {
      exp = addMonths(parse(h.delivree), hm.validite);
      d = days(this.today, exp);
      key = mesure === 'retrait' ? 'retiree' : mesure === 'suspension' ? 'susp' : d < 0 ? 'exp' : !prereqOk ? 'susp' : d <= horizon ? 'due' : 'ok';
    }
    const prereqNote = failing.length
      ? `Prérequis non satisfait : ${failing.map(c => c.label).join(', ')}`
      : dueChecks.length ? `À renouveler d’abord : ${dueChecks.map(c => `${c.label} (expire le ${fmt(c.exp!)})`).join(', ')}` : '';
    const mesureNote = mesure
      ? `${mesure === 'retrait' ? 'Retirée' : 'Suspendue'}${mesureLe ? ' le ' + fmt(mesureLe) : ''}${h.mesurePar ? ' par ' + h.mesurePar : ''}${h.mesureMotif ? ' — ' + h.mesureMotif : ''}`
      : '';
    // Après un retrait, la demande acceptée attend la nouvelle délivrance du service RH ; après une expiration, le renouvellement.
    const renouvellement = key === 'exp' && h.demande ? `Renouvellement demandé le ${fmt(parse(h.demande))}` : '';
    const archivee = habSuivie({ hm }) ? '' : 'Habilitation archivée au référentiel : plus suivie';
    const note = mesure === 'retrait'
      ? [mesureNote, h.demande ? `Nouvelle délivrance demandée le ${fmt(parse(h.demande))}` : '', archivee].filter(Boolean).join(' · ')
      : [mesureNote, renouvellement, prereqNote, archivee].filter(Boolean).join(' · ');
    return {
      id: 0, empId: 0, delivree: null, par: null, demande: null, mesure: null, mesureDate: null, mesureMotif: null, mesurePar: null, ...h,
      hm, checks, failing, prereqOk, exp, d, key, note, mesureLe,
    };
  }

  /** Mesures possibles sur un titre délivré : suspendre (RH ou manager direct), lever la suspension et retirer (RH). */
  habMesures(hi: HabInfo, rh: boolean): HabMesureAction[] {
    if (!hi.delivree || hi.mesure === 'retrait') return [];
    if (hi.mesure === 'suspension') return rh ? ['lever', 'retirer'] : [];
    return rh ? ['suspendre', 'retirer'] : ['suspendre'];
  }

  /** Échéance d'un titre délivré : sa date d'expiration, ou la date de la suspension / du retrait qui l'a invalidé. */
  habEcheance(h: HabInfo): { exp: Date; d: number } | null {
    if (h.mesureLe) return { exp: h.mesureLe, d: days(this.today, h.mesureLe) };
    return h.exp ? { exp: h.exp, d: h.d! } : null;
  }

  habAction(empId: number, hi: HabInfo): Proposal | null {
    // Lever une suspension ou délivrer de nouveau après un retrait reste une décision explicite du RH ; une habilitation
    // archivée n'appelle plus rien.
    if (hi.key === 'ok' || (hi.delivree && hi.mesure) || !habSuivie(hi)) return null;
    if (!hi.failing.length) {
      const pending = hi.key === 'pending';
      return { label: pending ? 'Délivrer' : 'Renouveler', intent: { type: 'openHab', empId, h: hi.h, mode: pending ? 'deliver' : 'renew' } };
    }
    const fc = hi.failing.find(c => c.type === 'cert');
    if (fc) {
      // Recyclage rattaché à une session passée : la clôture (présence, résultat) précède toute nouvelle inscription.
      const s = this.session(this.emp(empId)?.certs.find(c => c.id === fc.certId)?.sessionId ?? null);
      if (s && sessionActive(s) && s.date < this.ti) return { label: 'Clôturer la session', intent: { type: 'openCloture', sessionId: s.id } };
      return fc.certId != null
        ? { label: 'Planifier le recyclage', intent: { type: 'openPlan', empId, certId: fc.certId } }
        : { label: 'Inscrire à la formation', intent: { type: 'goFormation', f: fc.f! } };
    }
    // Visite déjà demandée : « Visite demandée le … » à la place, qui ouvre la demande en cours (impression, annulation).
    const dem = this.demandeVisite(empId);
    return { label: dem ? `Visite demandée le ${fmtShort(parse(dem.le))}` : 'Demander une visite médicale', intent: { type: 'medical', empId } };
  }

  /**
   * Collaborateurs enrichis de leurs statuts de conformité. Les salariés sortis (date de sortie passée) n'y sont plus :
   * conformité, échéances, tableaux de bord, habilitations. `sortis` : eux aussi (filtre « Sortis » de Collaborateurs).
   */
  enrich(horizon: number, onlyReg: boolean, opts: { sortis?: boolean } = {}): EmpX[] {
    const formIds = new Set(this.forms(onlyReg).map(f => f.id));
    return this.ds.employes.filter(e => opts.sortis || present(e, this.ti)).map(e => {
      // Seule la certification en vigueur de chaque formation compte ; les remplacées restent en historique.
      const { vigueur: rawCerts, anciennes } = this.certsOf(e, horizon);
      const certs = rawCerts.filter(c => formIds.has(c.f));
      const med = this.medInfo(e);
      const habs = e.habs.map(h => this.habInfo(h, rawCerts, med, horizon));
      // Titres d'une habilitation archivée : au dossier, hors du statut et des échéances.
      const suivies = habs.filter(habSuivie);
      // L'aptitude médicale compte dans le statut, même sans habilitation qui l'exige.
      const keys: StatusKey[] = [...certs.map(c => c.key), ...suivies.map(h => habStatus(h.key)), this.medKey(med, horizon)];
      // Titre de séjour expiré (art. L5221-8) : non conforme, comme un verdict seul « expiré » (shared/rules/contrats.ts).
      if (etatAutorisation(e, this.ti).expiree) keys.push('exp');
      const worst = keys.reduce<StatusKey>((w, k) => RANK[k] > RANK[w] ? k : w, 'ok');
      const dated = [
        ...certs.map(c => ({ exp: c.exp, d: c.d })), ...suivies.flatMap(h => this.habEcheance(h) ?? []),
        ...(med.exp && med.avis !== 'inapte' ? [{ exp: med.exp, d: med.d! }] : []),
      ];
      const next = dated.sort((a, b) => a.d - b.d)[0] || null;
      return { ...e, certs, rawCerts, anciennes, med, habs, worst, next };
    });
  }

  // — Voyages —
  visaFor(emp: Employe, code: string) {
    return (emp.visas || []).filter(v => v.dest === code).sort((a, b) => b.expire.localeCompare(a.expire))[0] || null;
  }
  vacRec(emp: Employe, v: VaccinId) {
    const r = (emp.vaccins || []).filter(x => x.v === v).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    if (!r) return null;
    const vm = VACCINS[v];
    return { ...r, vm, exp: vm.validite == null ? null : addMonths(parse(r.date), vm.validite) };
  }
  vaccinNames(list: VaccinId[]): string { return list.map(v => VACCINS[v].nom.replace(/ \(.*\)/, '')).join(', '); }
  destSummary(dest: Destination): string {
    const rule = VISA_RULES[dest.visa];
    return `${rule.label}${dest.visaSub ? ' (' + dest.visaSub + ')' : ''} · ${dest.oblig.length ? 'vaccin obligatoire : ' + this.vaccinNames(dest.oblig) : 'aucun vaccin obligatoire'} · recommandés : ${this.vaccinNames([...dest.rec, 'dtp'])} · passeport ${dest.passMois ? 'valide ' + dest.passMois + ' mois après l’entrée' : 'valide pendant le séjour'} · sécurité sociale : ${SECU_RULES[secuDe(dest)].label}.`;
  }

  /**
   * Dossier voyage d'un déplacement (ou d'une demande Keystone) : pièces du salarié (passeport, visa, vaccins) et
   * formalités de détachement du service RH (certificat de sécurité sociale, information écrite d'une mission longue).
   */
  readiness(emp: Employe, trip: Pick<Voyage, 'dest' | 'depart' | 'retour'> & Partial<Pick<Voyage, 'detachementLe' | 'informationLe'>>): Readiness {
    const dest = this.destOf(trip.dest)!, rule = VISA_RULES[dest.visa];
    const dep = parse(trip.depart), ret = parse(trip.retour), toGo = days(this.today, dep);
    const before = (lead: number) => { const x = new Date(dep.getTime()); x.setDate(x.getDate() - lead); return fmt(x); };
    const items: TripItem[] = [];
    const add = (o: Omit<TripItem, 'late' | 'statut' | 'cls'>) => {
      const late = !o.ok && o.mandatory && toGo < o.lead;
      items.push({
        ...o, late,
        statut: o.ok ? 'OK' : o.mandatory ? (late ? 'Urgent' : 'À faire') : (o.lapsed ? 'Rappel' : 'Conseillé'),
        cls: o.ok ? 'tag-neutral' : o.mandatory ? 'tag-accent' : 'tag-outline',
      });
    };
    const p = emp.passeport;
    if (!p) add({ k: 'passeport', label: 'Passeport', ok: false, mandatory: true, lead: 42, text: 'Non renseigné — à fournir ou à renouveler (4 à 6 semaines)', short: 'Passeport · à fournir', fix: { kind: 'passeport' } });
    else {
      const pe = parse(p.expire), need = addMonths(dep, dest.passMois);
      if (pe < ret) add({ k: 'passeport', label: 'Passeport', ok: false, mandatory: true, lead: 42, text: `${pe < this.today ? 'Expiré' : 'Expire'} le ${fmt(pe)} — renouvellement nécessaire`, short: 'Passeport · à renouveler', fix: { kind: 'passeport' } });
      else if (pe < need) add({ k: 'passeport', label: 'Passeport', ok: false, mandatory: true, lead: 42, text: `Valide jusqu’au ${fmt(pe)} — ${dest.passMois} mois de validité requis après l’entrée`, short: 'Passeport · validité insuffisante', fix: { kind: 'passeport' } });
      else add({ k: 'passeport', label: 'Passeport', ok: true, mandatory: true, lead: 0, text: `Valide jusqu’au ${fmt(pe)}` });
    }
    if (dest.visa === 'none') add({ k: 'visa', label: 'Visa', ok: true, mandatory: true, lead: 0, text: `Sans visa · ${dest.visaSub}` });
    else {
      const v = this.visaFor(emp, dest.code);
      if (v && parse(v.expire) >= ret) add({ k: 'visa', label: rule.label, ok: true, mandatory: true, lead: 0, text: `${v.type} valide jusqu’au ${fmt(parse(v.expire))}` });
      else add({
        k: 'visa', label: rule.label, ok: false, mandatory: true, lead: rule.delai,
        text: v ? `${v.type} expiré le ${fmt(parse(v.expire))} — à renouveler avant le ${before(rule.delai)}` : `À demander avant le ${before(rule.delai)} · ${rule.sub}`,
        short: `${rule.label} · à demander`, fix: { kind: 'visa', dest: dest.code },
      });
    }
    // Détachement : certificat de sécurité sociale du pays, obtenu par le service RH avant le départ.
    const secu = SECU_RULES[secuDe(dest)];
    if (trip.detachementLe) add({ k: 'detachement', label: secu.label, ok: true, mandatory: true, lead: 0, text: `Obtenu le ${fmt(parse(trip.detachementLe))} · ${secu.portee}` });
    else add({
      k: 'detachement', label: secu.label, ok: false, mandatory: true, lead: secu.delai,
      text: `À obtenir par le service RH avant le ${before(secu.delai)} · ${secu.demarche}`, short: `${secu.court} · à obtenir`,
    });
    // Mission de plus de 4 semaines consécutives : information écrite remise au salarié avant son départ (au plus tard la veille).
    const duree = days(dep, ret) + 1;
    if (duree > MISSION_LONGUE_JOURS) {
      const label = 'Information écrite (mission de plus de 4 semaines)';
      if (trip.informationLe) add({ k: 'information', label, ok: true, mandatory: true, lead: 0, text: `Remise au salarié le ${fmt(parse(trip.informationLe))}` });
      else add({
        k: 'information', label, ok: false, mandatory: true, lead: 1, short: 'Information écrite · à remettre',
        text: `Mission de ${duree} jours : à remettre par le service RH avant le ${fmt(dep)} — pays, durée, devise de la rémunération, avantages, conditions de rapatriement`,
      });
    }
    const vac = (v: VaccinId, mandatory: boolean) => {
      const vm = VACCINS[v], r = this.vacRec(emp, v), ok = !!r && (!r.exp || r.exp >= dep), lapsed = !!r && !ok;
      add({
        k: 'vaccin', label: vm.nom, ok, mandatory, lapsed, lead: vm.delai, fix: { kind: 'vaccin', v },
        short: `${vm.court} · ${mandatory ? 'obligatoire' : lapsed ? 'rappel' : 'conseillé'}`,
        text: ok
          ? (r!.exp ? `Valide jusqu’au ${fmt(r!.exp)}` : 'Certificat valable à vie') + (mandatory ? ' · exigé à l’entrée' : '')
          : mandatory
            ? (lapsed ? `Rappel dépassé (${fmt(r!.exp!)}) — exigé à l’entrée, avant le ${before(vm.delai)}` : `Exigé à l’entrée — vaccination avant le ${before(vm.delai)}`)
            : (lapsed ? `Rappel conseillé — protection échue le ${fmt(r!.exp!)}` : 'Recommandé pour cette destination'),
      });
    };
    dest.oblig.forEach(v => vac(v, true));
    [...dest.rec, 'dtp' as VaccinId].forEach(v => vac(v, false));
    const late = items.some(i => i.late), todo = items.filter(i => !i.ok && i.mandatory).length;
    return { dest, dep, ret, toGo, items, todo, status: late ? 'bloc' : todo ? 'todo' : 'pret' };
  }

  /**
   * Déplacements non terminés, avec l'état de préparation du dossier. Pour le manager, les vaccinations ne sont pas
   * transmises : l'état est celui calculé par le serveur (`tripStatus`), pas celui des pièces reçues.
   */
  tripsAll(): TripX[] {
    return this.ds.voyages
      .map(t => ({ t, emp: this.emp(t.empId) }))
      .filter((x): x is { t: Voyage; emp: Employe } => !!x.emp && x.t.retour >= this.ti)
      .sort((a, b) => a.t.depart.localeCompare(b.t.depart))
      .map(({ t, emp }) => {
        const r = this.readiness(emp, t);
        return { ...t, emp, r: t.dossierStatut ? { ...r, status: t.dossierStatut } : r };
      });
  }
  /** État du dossier voyage — précalculé par le serveur quand les pièces ne sont pas transmises. */
  tripStatus(t: Voyage): TripStatus {
    if (t.dossierStatut) return t.dossierStatut;
    const emp = this.emp(t.empId);
    return emp ? this.readiness(emp, t).status : 'todo';
  }

  /**
   * Formalités obligatoires manquantes d'un déplacement (voyage ou détachement), sans nommer un vaccin (« formalité
   * sanitaire ») — précalculées par le serveur (`dossierManque`) quand les pièces du dossier ne sont pas transmises.
   */
  formalitesManquantes(t: TripX): FormaliteManquante[] {
    return t.dossierManque ?? t.r.items.filter(i => !i.ok && i.mandatory)
      .map(i => ({ label: i.k === 'vaccin' ? 'formalité sanitaire' : i.label, late: i.late, detachement: PIECES_DETACHEMENT.includes(i.k) }));
  }

  travelOf(e: Employe, horizon: number) {
    return {
      pass: e.passeport ? (() => { const exp = parse(e.passeport!.expire), d = days(this.today, exp); return { exp, d, key: docKey(d, Math.max(horizon, 180)) }; })() : null,
      visas: e.visas.map(v => { const exp = parse(v.expire), d = days(this.today, exp); return { ...v, exp, d, key: docKey(d, horizon) }; }),
      vaccins: e.vaccins.map(x => {
        const r = this.vacRec(e, x.v)!;
        const d = r.exp ? days(this.today, r.exp) : null;
        return { ...r, d, key: r.exp ? docKey(d!, horizon) : 'ok' as StatusKey };
      }),
    };
  }

  originLabel(t: Voyage): string {
    return t.origine === 'keystone' ? `Initié par Keystone · chantier ${t.chantier}` : t.origine === 'formulaire' ? `Formulaire de demande ${t.ref}` : 'Créé dans Cursus';
  }

  // — Échéances —
  echeances(emps: EmpX[], horizon: number): EchItem[] {
    const ech: EchItem[] = [];
    // Un salarié sorti n'a plus d'échéance, même passé dans la liste (filtre « Sortis »).
    emps.filter(e => present(e, this.ti)).forEach(e => {
      e.certs.forEach(c => ech.push({
        kind: 'cert', kindLabel: c.fm.type === 'Réglementaire' ? 'Certification réglementaire' : 'Certification', label: c.fm.court, emp: e,
        exp: c.exp, d: c.d, key: c.key, statut: CERT_LABEL[c.key], cls: CLS[c.key], planned: !!c.session,
        plannedLabel: c.session ? `Session du ${fmtShort(parse(c.session.date))}` : c.sessionPassee ? SESSION_PASSEE : '',
        action: c.session ? null
          : c.sessionPassee ? { label: 'Clôturer', intent: { type: 'openCloture', sessionId: c.sessionPassee.id } }
          : { label: 'Planifier', intent: { type: 'openPlan', empId: e.id, certId: c.id } },
      }));
      e.habs.forEach(h => {
        const t = this.habEcheance(h);
        if (!t || !habSuivie(h)) return;
        // Prérequis d'aptitude en attente d'une visite déjà demandée : affichée comme planifiée, comme l'échéance de la visite.
        const a = this.habAction(e.id, h), visite = a?.intent.type === 'medical' && !!this.demandeVisite(e.id);
        ech.push({
          kind: 'hab', kindLabel: 'Habilitation', label: h.hm.nom, emp: e, exp: t.exp, d: t.d, key: habStatus(h.key),
          statut: HAB_LABEL[h.key], cls: HAB_CLS[h.key], planned: visite, plannedLabel: visite ? a!.label : '', action: a,
        });
      });
      const t = this.travelOf(e, horizon);
      if (t.pass) ech.push({ kind: 'trip', kindLabel: 'Passeport', label: 'Passeport', emp: e, exp: t.pass.exp, d: t.pass.d, key: t.pass.key, statut: DOC_LABEL[t.pass.key], cls: CLS[t.pass.key], planned: false, plannedLabel: '', action: { label: 'Mettre à jour', intent: { type: 'openFormalite', empId: e.id, kind: 'passeport' } } });
      t.visas.forEach(v => ech.push({ kind: 'trip', kindLabel: 'Visa · autorisation', label: `${v.type} — ${this.destOf(v.dest)?.pays ?? v.dest}`, emp: e, exp: v.exp, d: v.d, key: v.key, statut: DOC_LABEL[v.key], cls: CLS[v.key], planned: false, plannedLabel: '', action: { label: 'Mettre à jour', intent: { type: 'openFormalite', empId: e.id, kind: 'visa', dest: v.dest } } }));
      t.vaccins.filter(x => x.exp).forEach(x => ech.push({ kind: 'trip', kindLabel: 'Vaccination', label: `Rappel ${x.vm.nom}`, emp: e, exp: x.exp!, d: x.d!, key: x.key, statut: DOC_LABEL[x.key], cls: CLS[x.key], planned: false, plannedLabel: '', action: { label: 'Mettre à jour', intent: { type: 'openFormalite', empId: e.id, kind: 'vaccin', v: x.v } } }));
      // Aptitude médicale : visite périodique, visite jamais enregistrée (sans date, parmi les dépassées) ou avis
      // d'inaptitude (daté de la visite). Le verdict seul (vue manager) ne donne aucune échéance.
      const m = e.med;
      if (!m.verdictSeul) {
        const inapte = m.avis === 'inapte', sansDate = !m.exp, exp = inapte ? m.visite! : m.exp ?? this.today, key = this.medKey(m, horizon);
        ech.push({
          kind: 'med', kindLabel: 'Visite médicale', label: inapte ? 'Avis d’inaptitude' : sansDate ? 'Visite médicale non renseignée' : 'Aptitude médicale', emp: e,
          exp, d: days(this.today, exp), key, statut: inapte ? AVIS_MEDICAL.inapte.court : sansDate ? 'Non renseignée' : MED_LABEL[key], cls: CLS[key], sansDate,
          planned: !!m.demande, plannedLabel: m.demande ? `Visite demandée le ${fmtShort(parse(m.demande.le))}` : '',
          // Visite à demander : aptitude non valide ou à renouveler sous l'horizon d'alerte (sinon depuis la fiche).
          action: m.demande || key === 'ok' ? null : { label: 'Demander la visite', intent: { type: 'medical', empId: e.id } },
        });
      }
      // Fin d'essai, fin prévue du contrat, titre de séjour (shared/rules/contrats.ts).
      ech.push(...echeancesContrat(this, e, horizon));
    });
    // Échéance postérieure au départ (sortie enregistrée, fin de CDD…) : plus rien à renouveler.
    return ech.filter(x => present(x.emp, iso(x.exp)));
  }

  // — Chantiers Keystone : Go / No Go —
  /**
   * Présence d'une ressource sur un chantier : ses affectations ramenées aux dates du chantier (un repérage ou une
   * préparation hors de ces dates n'entre pas dans le Go / No Go), les périodes jointives fusionnées. Sans affectation
   * connue, les dates du chantier.
   */
  presence(empId: number, c: Chantier): Presence[] {
    const out: Presence[] = [];
    this.ds.missions
      .filter(m => m.empId === empId && m.projet === c.id && m.du <= c.fin && m.au >= c.debut)
      .map(m => ({ du: m.du > c.debut ? m.du : c.debut, au: m.au < c.fin ? m.au : c.fin }))
      .sort((a, b) => a.du.localeCompare(b.du))
      .forEach(p => {
        const der = out.at(-1);
        if (der && p.du <= addD(der.au, 1)) { if (p.au > der.au) der.au = p.au; } else out.push(p);
      });
    return out.length ? out : [{ du: c.debut, au: c.fin }];
  }

  /**
   * Présence restante : les périodes de présence ramenées à partir d'aujourd'hui, celles déjà finies écartées. Sur un
   * chantier en cours, une absence terminée ou une entrée déjà faite ne bloque plus une ressource qui a repris.
   */
  presenceRestante(empId: number, c: Chantier): Presence[] {
    return this.presence(empId, c).filter(s => s.au >= this.ti).map(s => ({ du: s.du > this.ti ? s.du : this.ti, au: s.au }));
  }

  resourceStatus(e: EmpX, c: Chantier, trips: TripX[]): { status: GngStatus; reasons: GngReason[] } {
    const start = parse(c.debut), end = parse(c.fin), reasons: GngReason[] = [];
    const push = (level: GngReason['level'], code: CodeMotif, minimal: string, detailed: string, transmis?: string) => {
      reasons.push({ level, code, minimal, detailed, ...(transmis ? { transmis } : {}) });
    };
    // Disponibilité, déplacement et formalités : sur la présence restante (vide une fois la présence finie).
    const sejours = this.presenceRestante(e.id, c), du = sejours[0]?.du ?? c.debut, au = sejours.at(-1)?.au ?? c.fin;
    const pendant = (p: { du: ISODate; au: ISODate }) => sejours.some(s => p.du <= s.au && p.au >= s.du);
    // Disponibilité sur la présence : contrat en cours (fin d'un CDD, d'une mission d'intérim, d'une alternance),
    // aucune absence en vigueur. Jamais la nature d'une absence, même dans le libellé du partage détaillé.
    const borne = sejours.length ? borneContrat(e, du, au) : null;
    if (borne) push('nogo', 'CONTRAT', du < e.entree ? 'Contrat non commencé au début du chantier' : 'Contrat terminé avant la fin du chantier', `${cap(borne)} — présence prévue ${periodeTexte(du, au)}`);
    // Titre de séjour expiré : état du jour, comme l'aptitude. Keystone ne reçoit que le libellé générique, jamais la
    // mention d'un titre ; le service RH lit le détail sur la fiche.
    const titre = etatAutorisation(e, this.ti);
    if (titre.expiree) {
      push('nogo', 'CONTRAT', SITUATION_A_REGULARISER, titre.verdictSeul ? `${SITUATION_A_REGULARISER} avec le service RH` : `Autorisation de travail expirée le ${fmt(parse(titre.expire!))}`, SITUATION_A_REGULARISER);
    }
    this.ds.absences.filter(a => a.empId === e.id && absenceActive(a) && pendant(a)).forEach(a => {
      if (a.statut === 'demandee') push('reserve', 'ABSENCE', 'Demande d’absence en attente pendant le chantier', `Demande d’absence en attente ${periodeTexte(a.du, a.au)}`);
      else push('nogo', 'ABSENCE', 'Absent pendant le chantier', `Absent ${periodeTexte(a.du, a.au)}`);
    });
    // Aptitude médicale : état du jour seulement, jamais rapporté aux dates de présence, que Keystone fixe lui-même (des
    // affectations sondes en déduiraient la date d'une visite ou la fin d'une restriction). Inapte : No Go. Aptitude non
    // valide (visite périodique en retard, aucune visite) ou restrictions en vigueur aujourd'hui : une seule réserve, qu'une
    // habilitation exigée dépende de l'aptitude ou non. Keystone n'en reçoit que le code et, en partage détaillé, un
    // libellé neutre : ni date, ni restriction, ni même leur existence (réservée au manager).
    const med = e.med;
    if (med.avis === 'inapte') push('nogo', 'APTITUDE', 'Inapte au poste', 'Avis d’inaptitude du médecin du travail', 'Inapte au poste');
    else {
      const retard = med.ok ? '' : med.verdictSeul ? 'Aptitude médicale non valide' : !med.exp ? 'Aucune visite médicale enregistrée' : 'Visite médicale périodique en retard';
      const restreinte = med.restrictions.some(r => restrictionEnVigueur(r, this.ti)) ? 'Restrictions d’aptitude en vigueur' : '';
      if (retard || restreinte) {
        push('reserve', 'APTITUDE', retard || restreinte, `${[retard, restreinte].filter(Boolean).join(' · ')} : affectation à vérifier avec le service RH`, APTITUDE_A_VERIFIER);
      }
    }
    c.habs.forEach(h => {
      const hm = this.hm(h), hi = e.habs.find(x => x.h === h);
      if (!hi) return push('nogo', 'HABILITATION', 'Habilitation requise absente', `${hm.nom} — non détenue`);
      if (hi.key === 'pending') return push('nogo', 'HABILITATION', 'Habilitation requise en attente', `${hm.nom} — en attente de délivrance`);
      // Suspension ou retrait par l'employeur : code dédié, jamais le motif (texte libre réservé à Cursus).
      if (hi.mesure === 'retrait') return push('nogo', 'HABILITATION_RETIREE', 'Habilitation requise retirée', `${hm.nom} — retirée${hi.mesureLe ? ' le ' + fmt(hi.mesureLe) : ''}`);
      if (hi.mesure === 'suspension') return push('nogo', 'HABILITATION_SUSPENDUE', 'Habilitation requise suspendue', `${hm.nom} — suspendue${hi.mesureLe ? ' depuis le ' + fmt(hi.mesureLe) : ''}`);
      if (hi.key === 'exp' || hi.key === 'susp' || hi.exp! < start) return push('nogo', 'HABILITATION', 'Habilitation requise non valide', `${hm.nom} — ${hi.key === 'susp' ? 'suspendue (prérequis non satisfait)' : 'expirée au démarrage'}`);
      if (hi.exp! < end) push('reserve', 'HABILITATION', 'Habilitation expirant pendant le chantier', `${hm.nom} — expire le ${fmt(hi.exp!)}, en cours de chantier`);
    });
    c.certs.forEach(f => {
      const fm = this.fm(f), ci = certEnVigueur(e.rawCerts, f);
      if (!ci) return push('nogo', 'CERTIFICATION', 'Certification requise absente', `${fm.court} — non détenue`);
      // Seule une session à venir vaut recyclage planifié : une session passée non clôturée, non.
      const recycl = !!ci.session && parse(ci.session.date) < start;
      if (ci.exp < start) return push(recycl ? 'reserve' : 'nogo', 'CERTIFICATION', recycl ? 'Recyclage planifié avant le démarrage' : 'Certification requise non valide', `${fm.court} — expire le ${fmt(ci.exp)}${recycl ? ', recyclage le ' + fmt(parse(ci.session!.date)) : ''}`);
      if (ci.exp < end) push('reserve', 'CERTIFICATION', 'Certification expirant pendant le chantier', `${fm.court} — expire le ${fmt(ci.exp)}, en cours de chantier`);
    });
    // Présence finie (chantier en cours, ressource rentrée) : plus de déplacement à exiger.
    if (c.pays !== 'FR' && sejours.length) {
      // Déplacements retenus : rattachés au chantier, ou vers son pays pendant la présence (un voyage des mois plus tôt ne vaut pas).
      const siens = trips.filter(x => x.empId === e.id && (x.chantier === c.id || (x.dest === c.pays && pendant({ du: x.depart, au: x.retour }))));
      const dem = this.ds.demandesKeystone.some(d => d.empId === e.id && d.chantier === c.id && d.statut === 'attente');
      if (!siens.length) push('reserve', 'DEPLACEMENT', dem ? 'Déplacement en attente de validation RH' : 'Déplacement à créer', dem ? 'Demande Keystone en attente de validation RH' : 'Aucun déplacement créé pour ce chantier');
      else {
        // Chaque période de présence (restante) doit tenir dans un déplacement : départ au plus tard le premier jour, retour au
        // plus tôt le dernier. Couverte, seules comptent les formalités des déplacements qui la couvrent ; sinon, celles de tous
        // les déplacements retenus.
        const couvrants = sejours.map(p => siens.find(t => t.depart <= p.du && t.retour >= p.au));
        const couverte = couvrants.every(t => !!t), retenus = couverte ? [...new Set(couvrants as TripX[])] : siens;
        if (!couverte) {
          push('reserve', 'DEPLACEMENT_PARTIEL', 'Déplacement ne couvrant pas toute la présence',
            `Couverture partielle : ${siens.map(t => `déplacement ${periodeTexte(t.depart, t.retour)}`).join(', ')}, présence ${periodeTexte(du, au)}`);
        }
        const manquantes = (t: TripX, detachement: boolean) => this.formalitesManquantes(t).filter(m => m.detachement === detachement);
        const voyage = retenus.flatMap(t => manquantes(t, false)), detachement = retenus.flatMap(t => manquantes(t, true));
        const liste = (items: FormaliteManquante[]) => [...new Set(items.map(i => i.label))].join(', ');
        if (voyage.some(i => i.late)) push('nogo', 'FORMALITES_VOYAGE', 'Formalités de voyage hors délai', `Formalités hors délai : ${liste(voyage)}`);
        else if (voyage.length) push('reserve', 'FORMALITES_VOYAGE', 'Formalités de voyage en cours', `Formalités en cours : ${liste(voyage)}`);
        // Formalités de détachement (décision de l'entreprise : bloquent si elles ne sont pas faites au départ) : réserve
        // avant le départ, même une fois le délai indicatif d'obtention entamé (le dossier voyage les dit alors « Urgent » ;
        // un certificat A1 demandé en ligne est souvent délivré tout de suite) ; No Go à partir du jour du départ.
        const parti = retenus.some(t => t.r.toGo <= 0 && manquantes(t, true).length > 0);
        if (parti) push('nogo', 'DETACHEMENT', 'Formalités de détachement non faites au départ', `Détachement non fait au départ : ${liste(detachement)}`);
        else if (detachement.length) {
          push('reserve', 'DETACHEMENT', 'Formalités de détachement à faire avant le départ', `Détachement à préparer${detachement.some(i => i.late) ? ' d’urgence' : ''} : ${liste(detachement)}`);
        }
      }
    }
    return { status: reasons.some(r => r.level === 'nogo') ? 'nogo' : reasons.length ? 'reserve' : 'go', reasons };
  }

  /**
   * Verdict des chantiers actifs ; un chantier archivé dans Keystone n'est plus évalué. Une ressource sortie de l'entreprise,
   * absente de `emps` (Domain.enrich), reste évaluée : « No Go CONTRAT » prévient Keystone au lieu de la faire disparaître.
   */
  evaluateChantiers(emps: EmpX[], trips: TripX[]): ChantierEval[] {
    let sortis: EmpX[] | null = null;
    const sortie = (id: number) => (sortis ??= this.enrich(this.ds.settings.horizonAlerte, false, { sortis: true }).filter(e => !present(e, this.ti))).find(e => e.id === id);
    return this.ds.referentiels.chantiers.filter(c => c.statut !== 'archive').map(c => {
      const res = c.ressources
        .map(id => emps.find(x => x.id === id) ?? sortie(id))
        .filter((e): e is EmpX => !!e)
        .map(e => ({ e, ...this.resourceStatus(e, c, trips) }));
      const status: GngStatus = res.some(r => r.status === 'nogo') ? 'nogo' : res.some(r => r.status === 'reserve') ? 'reserve' : 'go';
      return { c, res, status };
    });
  }

  /**
   * Ancienne réponse (route obsolète, sans /v1) : motifs en codes simples, ou en objets en mode détaillé.
   * La réponse de l'API v1 est `verdictKeystone`.
   */
  keystonePayload(ch: ChantierEval, detail: boolean, evalueLe = `${this.ti}T07:00:00+02:00`) {
    return {
      chantier: ch.c.id, evalue_le: evalueLe, statut: GNG_CODE[ch.status],
      ressources: ch.res.map(r => ({
        matricule: identifiantKeystone(this.ds.settings.identifiantKeystone, r.e), statut: GNG_CODE[r.status],
        motifs: r.reasons.map(x => detail ? { code: x.code, libelle: x.transmis ?? x.detailed } : x.code),
      })),
    };
  }

  /**
   * Verdict de l'API Keystone v1 : matricules et codes de motif normalisés. Chaque motif est un objet
   * (`code`, `niveau`) ; le libellé n'est ajouté qu'en mode détaillé, jamais une donnée de santé.
   */
  verdictKeystone(ch: ChantierEval, detail: boolean, evalueLe = `${this.ti}T07:00:00+02:00`) {
    return {
      chantier: ch.c.id, evalue_le: evalueLe, statut: GNG_CODE[ch.status],
      ressources: ch.res.map(r => ({
        matricule: identifiantKeystone(this.ds.settings.identifiantKeystone, r.e), statut: GNG_CODE[r.status],
        motifs: r.reasons.map(x => ({ code: x.code, niveau: GNG_CODE[x.level], ...(detail ? { libelle: x.transmis ?? x.detailed } : {}) })),
      })),
    };
  }

  isoToday(): ISODate { return iso(this.today); }
}
