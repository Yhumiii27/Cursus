// Règles métier de Cursus : conformité des certifications et habilitations,
// formalités de voyage, Go / No Go des chantiers Keystone.
// Fonctions pures d'un instantané de données — utilisées par le client pour
// l'affichage et par le serveur pour valider les actions et les intégrations.
import {
  CERT_LABEL, CLS, DOC_LABEL, GNG_CODE, HAB_CLS, HAB_LABEL, MED_VALIDITE, RANK, SESSION_PASSEE, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT, VACCINS, VISA_RULES,
  type CodeMotif, type HabKey, type HabMesureAction, type StatusKey,
} from './constants.ts';
import { addD, addMonths, days, isFerie, iso, parse, weekday } from './dates.ts';
import { fmt, fmtShort, matricule } from './format.ts';
import { absenceActive, absenceBloque } from './rules/absences.ts';
import type {
  Certification, Chantier, Dataset, Destination, Employe, Formation, HabTitre, HabType, ISODate, Session,
  Statut, TempsTravail, TripStatus, TypeContrat, VaccinId, Voyage,
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
export interface MedInfo { ok: boolean; exp: Date | null; d: number | null; text: string }
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
  | { type: 'openCloture'; sessionId: number };
export type FormaliteKind = 'passeport' | 'visa' | 'vaccin';
export interface Proposal { label: string; intent: UiIntent }

export interface TripItem {
  k: FormaliteKind; label: string; ok: boolean; mandatory: boolean; lapsed?: boolean; lead: number; text: string; short?: string;
  fix?: { kind: FormaliteKind; dest?: string; v?: VaccinId }; late: boolean; statut: string; cls: string;
}
export interface Readiness { dest: Destination; dep: Date; ret: Date; toGo: number; items: TripItem[]; todo: number; status: TripStatus }
export interface TripX extends Voyage { emp: Employe; r: Readiness }

export interface EchItem {
  kind: 'cert' | 'hab' | 'trip'; kindLabel: string; label: string; emp: EmpX; exp: Date; d: number; key: StatusKey;
  statut: string; cls: string; planned: boolean; plannedLabel: string; action: Proposal | null;
}

export type GngStatus = 'go' | 'reserve' | 'nogo';
export interface GngReason { level: 'reserve' | 'nogo'; code: CodeMotif; minimal: string; detailed: string }
export interface ChantierEval { c: Chantier; res: { e: EmpX; status: GngStatus; reasons: GngReason[] }[]; status: GngStatus }

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
 * Titre détenu ou déjà demandé, qu'un collaborateur ne peut pas redemander. Un titre expiré peut l'être, un titre
 * retiré aussi tant qu'aucune demande de nouvelle délivrance n'a été acceptée (`demande` renseignée).
 */
export const habEnCours = (h: Pick<HabInfo, 'key' | 'demande'>) => h.key === 'retiree' ? !!h.demande : h.key !== 'exp';

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
  forms(onlyReg: boolean): Formation[] {
    const all = this.ds.referentiels.formations;
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

  medInfo(e: Employe): MedInfo {
    if (!e.visite) {
      if (e.aptitude) return { ok: e.aptitude.ok, exp: null, d: null, text: 'Aptitude médicale : information réservée au service RH' };
      return { ok: false, exp: null, d: null, text: 'Visite médicale non renseignée' };
    }
    const date = parse(e.visite), exp = addMonths(date, MED_VALIDITE), d = days(this.today, exp);
    return { ok: d >= 0, exp, d, text: d >= 0 ? `Visite du ${fmt(date)} · aptitude valide jusqu’au ${fmt(exp)}` : `Aptitude échue le ${fmt(exp)} — visite à programmer` };
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
    // Après un retrait, la demande acceptée attend la nouvelle délivrance du service RH.
    const note = mesure === 'retrait'
      ? [mesureNote, h.demande ? `Nouvelle délivrance demandée le ${fmt(parse(h.demande))}` : ''].filter(Boolean).join(' · ')
      : [mesureNote, prereqNote].filter(Boolean).join(' · ');
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
    // Lever une suspension ou délivrer de nouveau après un retrait reste une décision explicite du RH.
    if (hi.key === 'ok' || (hi.delivree && hi.mesure)) return null;
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
    return { label: 'Demander une visite médicale', intent: { type: 'medical', empId } };
  }

  /** Collaborateurs enrichis de leurs statuts de conformité. */
  enrich(horizon: number, onlyReg: boolean): EmpX[] {
    const formIds = new Set(this.forms(onlyReg).map(f => f.id));
    return this.ds.employes.map(e => {
      // Seule la certification en vigueur de chaque formation compte ; les remplacées restent en historique.
      const { vigueur: rawCerts, anciennes } = this.certsOf(e, horizon);
      const certs = rawCerts.filter(c => formIds.has(c.f));
      const med = this.medInfo(e);
      const habs = e.habs.map(h => this.habInfo(h, rawCerts, med, horizon));
      const keys: StatusKey[] = [...certs.map(c => c.key), ...habs.map(h => habStatus(h.key))];
      const worst = keys.reduce<StatusKey>((w, k) => RANK[k] > RANK[w] ? k : w, 'ok');
      const dated = [...certs.map(c => ({ exp: c.exp, d: c.d })), ...habs.flatMap(h => this.habEcheance(h) ?? [])];
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
    return `${rule.label}${dest.visaSub ? ' (' + dest.visaSub + ')' : ''} · ${dest.oblig.length ? 'vaccin obligatoire : ' + this.vaccinNames(dest.oblig) : 'aucun vaccin obligatoire'} · recommandés : ${this.vaccinNames([...dest.rec, 'dtp'])} · passeport ${dest.passMois ? 'valide ' + dest.passMois + ' mois après l’entrée' : 'valide pendant le séjour'}.`;
  }

  readiness(emp: Employe, trip: { dest: string; depart: ISODate; retour: ISODate }): Readiness {
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
    emps.forEach(e => {
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
        if (t) ech.push({
          kind: 'hab', kindLabel: 'Habilitation', label: h.hm.nom, emp: e, exp: t.exp, d: t.d, key: habStatus(h.key),
          statut: HAB_LABEL[h.key], cls: HAB_CLS[h.key], planned: false, plannedLabel: '', action: this.habAction(e.id, h),
        });
      });
      const t = this.travelOf(e, horizon);
      if (t.pass) ech.push({ kind: 'trip', kindLabel: 'Passeport', label: 'Passeport', emp: e, exp: t.pass.exp, d: t.pass.d, key: t.pass.key, statut: DOC_LABEL[t.pass.key], cls: CLS[t.pass.key], planned: false, plannedLabel: '', action: { label: 'Mettre à jour', intent: { type: 'openFormalite', empId: e.id, kind: 'passeport' } } });
      t.visas.forEach(v => ech.push({ kind: 'trip', kindLabel: 'Visa · autorisation', label: `${v.type} — ${this.destOf(v.dest)?.pays ?? v.dest}`, emp: e, exp: v.exp, d: v.d, key: v.key, statut: DOC_LABEL[v.key], cls: CLS[v.key], planned: false, plannedLabel: '', action: { label: 'Mettre à jour', intent: { type: 'openFormalite', empId: e.id, kind: 'visa', dest: v.dest } } }));
      t.vaccins.filter(x => x.exp).forEach(x => ech.push({ kind: 'trip', kindLabel: 'Vaccination', label: `Rappel ${x.vm.nom}`, emp: e, exp: x.exp!, d: x.d!, key: x.key, statut: DOC_LABEL[x.key], cls: CLS[x.key], planned: false, plannedLabel: '', action: { label: 'Mettre à jour', intent: { type: 'openFormalite', empId: e.id, kind: 'vaccin', v: x.v } } }));
    });
    return ech;
  }

  // — Chantiers Keystone : Go / No Go —
  resourceStatus(e: EmpX, c: Chantier, trips: TripX[]): { status: GngStatus; reasons: GngReason[] } {
    const start = parse(c.debut), end = parse(c.fin), reasons: GngReason[] = [];
    const push = (level: GngReason['level'], code: CodeMotif, minimal: string, detailed: string) => { reasons.push({ level, code, minimal, detailed }); };
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
    if (c.pays !== 'FR') {
      const t = trips.find(x => x.empId === e.id && x.chantier === c.id) || trips.find(x => x.empId === e.id && x.dest === c.pays);
      const dem = this.ds.demandesKeystone.some(d => d.empId === e.id && d.chantier === c.id && d.statut === 'attente');
      if (!t) push('reserve', 'DEPLACEMENT', dem ? 'Déplacement en attente de validation RH' : 'Déplacement à créer', dem ? 'Demande Keystone en attente de validation RH' : 'Aucun déplacement créé pour ce chantier');
      else if (t.r.status !== 'pret') {
        const list = [...new Set(t.r.items.filter(i => !i.ok && i.mandatory).map(i => i.k === 'vaccin' ? 'formalité sanitaire' : i.label))].join(', ');
        if (t.r.status === 'bloc') push('nogo', 'FORMALITES_VOYAGE', 'Formalités de voyage hors délai', `Formalités hors délai : ${list}`);
        else push('reserve', 'FORMALITES_VOYAGE', 'Formalités de voyage en cours', `Formalités en cours : ${list}`);
      }
    }
    return { status: reasons.some(r => r.level === 'nogo') ? 'nogo' : reasons.length ? 'reserve' : 'go', reasons };
  }

  /** Verdict des chantiers actifs ; un chantier archivé dans Keystone n'est plus évalué. */
  evaluateChantiers(emps: EmpX[], trips: TripX[]): ChantierEval[] {
    return this.ds.referentiels.chantiers.filter(c => c.statut !== 'archive').map(c => {
      const res = c.ressources
        .map(id => emps.find(x => x.id === id))
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
        matricule: matricule(r.e.id), statut: GNG_CODE[r.status],
        motifs: r.reasons.map(x => detail ? { code: x.code, libelle: x.detailed } : x.code),
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
        matricule: matricule(r.e.id), statut: GNG_CODE[r.status],
        motifs: r.reasons.map(x => ({ code: x.code, niveau: GNG_CODE[x.level], ...(detail ? { libelle: x.detailed } : {}) })),
      })),
    };
  }

  isoToday(): ISODate { return iso(this.today); }
}
