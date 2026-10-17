// Fiche collaborateur : création ou modification complète (RH) ; intitulé du poste et jours non
// travaillés du temps partiel pour le manager d'un membre de son équipe.
// Poste choisi dans la liste du référentiel (components/PosteChoix.tsx), dont les exigences s'appliquent ; le service RH
// peut aussi en saisir un nouveau, ajouté au référentiel sans exigence.
// Matricule de paie : unique ; reprendre celui d'un salarié sorti (réembauche) se confirme, par l'administrateur RH, qui
// seul change ou retire un matricule déjà enregistré.
import { useEffect, useRef, useState } from 'react';
import { isValidDate } from '../../../shared/dates.ts';
import { AVIS_MEDICAL, MODE_NOTIFICATION_LABEL, MOTIFS_REPRISE, STATUTS, TEMPS_TRAVAIL, TYPES_CONTRAT } from '../../../shared/constants.ts';
import { cap, equipeLabel, fmtIso, plural } from '../../../shared/format.ts';
import { reposForfait } from '../../../shared/rules/conges.ts';
import { matriculesPris, normaliserMatricule } from '../../../shared/rules/matricules.ts';
import { essaiMaximum, limitePrevenance, rttPerdus, SEMAINES_FIGEES, soldeRttTexte, sortieTexte } from '../../../shared/rules/contrats.ts';
import { adressesPrises } from '../../../shared/rules/messagerie.ts';
import { JOURS_SEMAINE, MANAGER_FIELDS, PROFIL_FIELDS, PROFIL_VIDE, normaliserProfil, profilOf, validerProfil, type ProfilInput } from '../../../shared/rules/profil.ts';
import { champsAEnvoyer, champsDifferents, champsEnConflit, LIBELLE_CHAMP_FICHE } from '../../../shared/rules/fiche-concurrente.ts';
import { contratFige } from '../../../shared/rules/temps.ts';
import type { Statut, TempsTravail, TypeContrat } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine, NoteAccent, SectionLabel, Seg } from '../components/ui.tsx';
import { NOUVEAU_POSTE, PosteChoix, PosteLibelle } from '../components/PosteChoix.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** État du formulaire : les nombres et dates restent des chaînes pendant la saisie. */
interface Form {
  nom: string; poste: string; equipe: string;
  /** Date de naissance saisie ; `naissance` : année de la fiche, gardée tant que la date reste inconnue (fiche antérieure). */
  naissanceLe: string; naissance: string;
  /** Poste du référentiel choisi (identifiant), `''` : aucun, NOUVEAU_POSTE : intitulé saisi, poste créé à l'enregistrement. */
  posteId: string;
  statut: Statut; typeContrat: TypeContrat; entree: string; fin: string; agence: string; email: string; matriculePaie: string;
  temps: TempsTravail; heures: string; forfaitHeures: string; forfaitJours: string; jourOff: number[];
  visite: string; repriseMotif: string; repriseDate: string;
  /** Période d'essai écrite au contrat : dernier jour, et dernier jour après renouvellement (aucune valeur proposée). */
  essaiFin: string; essaiRenouvele: string;
  /** Date d'effet d'un changement d'organisation du temps (défaut : aujourd'hui). */
  effet: string;
}

/** Paramètres de l'organisation du temps : leur modification prend effet à une date choisie (`tempsDepuis`). */
const REGIME_TEMPS: (keyof ProfilInput)[] = ['temps', 'heures', 'forfaitHeures', 'forfaitJours'];

const numStr = (n: number | null | undefined) => n == null || Number.isNaN(n) ? '' : String(n).replace('.', ',');
const toNum = (s: string) => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  return t === '' ? null : Number(t);
};

function toForm(p: ProfilInput, today: string): Form {
  return {
    nom: p.nom, poste: p.poste, posteId: p.posteId != null ? String(p.posteId) : '', equipe: p.equipe ?? '', naissanceLe: p.naissanceLe ?? '', naissance: numStr(p.naissance),
    statut: p.statut, typeContrat: p.typeContrat, entree: p.entree, fin: p.fin ?? '', agence: p.agence ?? '', email: p.email ?? '', matriculePaie: p.matriculePaie ?? '',
    temps: p.temps, heures: numStr(p.heures),
    forfaitHeures: numStr(p.forfaitHeures ?? (p.temps === 'forfait_heures_annuel' ? 1607 : null)),
    forfaitJours: numStr(p.forfaitJours ?? (p.temps === 'forfait_jours' ? 218 : null)),
    jourOff: [...(p.jourOff ?? [])],
    visite: p.visite ?? '', repriseMotif: p.repriseMotif ?? '', repriseDate: p.repriseDate ?? '',
    essaiFin: p.essaiFin ?? '', essaiRenouvele: p.essaiRenouveleJusquau ?? '',
    effet: today,
  };
}

/** Fiche saisie ; `tempsDepuis` : date d'effet de l'organisation du temps à enregistrer. */
function toInput(f: Form, tempsDepuis: string | null): ProfilInput {
  return {
    nom: f.nom, poste: f.poste, posteId: posteIdSaisi(f.posteId), equipe: f.equipe || null, statut: f.statut, typeContrat: f.typeContrat, temps: f.temps,
    heures: toNum(f.heures), forfaitHeures: toNum(f.forfaitHeures), forfaitJours: toNum(f.forfaitJours), jourOff: f.jourOff, tempsDepuis,
    entree: f.entree, fin: f.fin || null, naissanceLe: f.naissanceLe || null, naissance: toNum(f.naissance) ?? Number.NaN, agence: f.agence || null, matriculePaie: f.matriculePaie || null, email: f.email || null,
    visite: f.visite || null, repriseMotif: f.repriseMotif || null, repriseDate: f.repriseDate || null,
    essaiFin: f.essaiFin || null, essaiRenouveleJusquau: f.essaiRenouvele || null,
  };
}

/** Champ de la fiche saisi par chaque champ du formulaire (la date d'effet n'en a pas : elle reste celle saisie). */
const CHAMP_DU_FORM: Partial<Record<keyof Form, keyof ProfilInput>> = { essaiRenouvele: 'essaiRenouveleJusquau' };

/**
 * Fiche reprise à jour après une modification concurrente : les champs modifiés entre-temps (et ceux de leur groupe)
 * prennent la valeur enregistrée, les autres saisies de la personne sont gardées.
 */
function reprendreAJour(f: Form, initial: ProfilInput, actuelle: ProfilInput, today: string): Form {
  const avant = toForm(initial, today), apres = toForm(actuelle, today);
  const repris = champsDifferents(initial, actuelle);
  const out = { ...apres, effet: f.effet };
  for (const k of Object.keys(f) as (keyof Form)[]) {
    if (k === 'effet') continue;
    const champ = CHAMP_DU_FORM[k] ?? (k as keyof ProfilInput);
    const saisi = JSON.stringify(f[k]) !== JSON.stringify(avant[k]);
    if (saisi && !repris.has(champ)) (out as Record<string, unknown>)[k] = f[k];
  }
  return out;
}

/** Poste du référentiel saisi : identifiant, ou aucun (intitulé seul, nouveau poste). */
const posteIdSaisi = (v: string) => (v && v !== NOUVEAU_POSTE ? Number(v) : null);

const same = (a: ProfilInput, b: ProfilInput) => PROFIL_FIELDS.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/**
 * Champ concerné par une erreur de `validerProfil` (shared/rules/profil.ts), reconnu à son message : l'erreur
 * s'affiche sous ce champ. Un message non reconnu reste dans la liste sous le formulaire.
 */
const CHAMP_ERREUR: [RegExp, keyof Form][] = [
  [/^Nom requis/, 'nom'], [/^Poste requis/, 'poste'], [/^Équipe inconnue/, 'equipe'], [/naissance/, 'naissanceLe'],
  [/^Date d’entrée/, 'entree'], [/renouvellement de l’essai/i, 'essaiRenouvele'], [/période d’essai/, 'essaiFin'], [/date de fin/i, 'fin'], [/^Agence d’intérim/, 'agence'], [/^Manager de l’équipe/, 'typeContrat'],
  [/^Un intérimaire ne peut|cadre dirigeant/, 'temps'], [/date d’effet/i, 'effet'],
  [/^Temps partiel|^Forfait hebdomadaire/, 'heures'], [/^Forfait annuel en heures/, 'forfaitHeures'], [/^Forfait jours/, 'forfaitJours'],
  [/^Au moins un jour travaillé|^Répartition impossible/, 'jourOff'],
  [/visite médicale/, 'visite'], [/^Date de reprise/, 'repriseDate'], [/^Motif de l’absence longue/, 'repriseMotif'],
  [/^Matricule de paie/, 'matriculePaie'],
];

/** Erreurs rattachées à leur champ, et celles sans champ. */
function repartir(errors: string[]) {
  const champs: Partial<Record<keyof Form, string>> = {};
  const autres: string[] = [];
  for (const m of errors) {
    const c = CHAMP_ERREUR.find(([r]) => r.test(m))?.[1];
    if (c) champs[c] = champs[c] ? `${champs[c]} ${m}` : m;
    else autres.push(m);
  }
  return { champs, autres };
}

/** Jours non travaillés du temps partiel (cases à cocher du lundi au vendredi). */
function JoursOff({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (i: number, on: boolean) => onChange(on ? [...value, i].sort() : value.filter(j => j !== i));
  return (
    <div role="group" aria-label="Jours non travaillés" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
      {JOURS_SEMAINE.map((j, i) => (
        <label key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(i)} onChange={ev => toggle(i, ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
          {j}
        </label>
      ))}
    </div>
  );
}

export function EmployeDialog({ empId, equipe: equipe0 }: { empId?: number | null; equipe?: string | null }) {
  const d = useDomain();
  const { rh, admin, manager, me } = useRole();
  const { run, closeDialog, setUi, notify } = useStore();
  const emp = empId != null ? d.emp(empId) ?? null : null;
  const creation = empId == null;
  /** Manager direct d'un membre de son équipe : modification limitée. */
  const limited = !rh && manager && !!emp && emp.id !== me && d.mgrOf(emp) === me;

  // Fiche de référence : celle de l'ouverture du dialogue (reprise à jour après une modification concurrente).
  const [initial, setInitial] = useState<ProfilInput>(() => emp ? profilOf(emp) : PROFIL_VIDE(equipe0 && d.equipes.includes(equipe0) ? equipe0 : null, d.ti));
  /** Champs envoyés avec leur valeur d'origine lors d'un enregistrement refusé pour modification concurrente (412). */
  const [concurrent, setConcurrent] = useState<Partial<ProfilInput> | null>(null);
  const conflitRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (concurrent) conflitRef.current?.focus(); }, [concurrent]);
  const [f, setF] = useState<Form>(() => ({ ...toForm(initial, d.ti), naissance: creation ? '' : numStr(initial.naissance) }));
  // Fiche qui n'a que l'année de naissance (antérieure à la date complète) : l'année est gardée tant que la date manque.
  const anneeSeule = !creation && !initial.naissanceLe && Number.isFinite(initial.naissance) ? initial.naissance : null;
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  // Réembauche : réutilisation du matricule de paie d'un salarié sorti, confirmée par l'administrateur RH (matricule confirmé).
  const [reutiliser, setReutiliser] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  /** Confirmation demandée : le nouveau régime ferme le compteur de RTT de l'année (garde-fou du changement de régime). */
  const [confRtt, setConfRtt] = useState(false);
  const verif = useVerification();

  if ((creation && !rh) || (!creation && (!emp || !(rh || limited)))) return null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF(s => ({ ...s, [k]: v })); setTouched(true); };
  /** Poste choisi dans la liste (son intitulé devient celui de la fiche), ou intitulé d'un nouveau poste. */
  const choisirPoste = (posteId: string, poste: string) => { setF(s => ({ ...s, posteId, poste })); setTouched(true); };
  const setTemps = (t: TempsTravail) => {
    setF(s => {
      const n = { ...s, temps: t };
      const h = toNum(s.heures);
      if (t === 'partiel' && (h == null || h >= 35)) n.heures = '';
      if (t === 'forfait_heures_hebdo' && (h == null || h <= 35)) n.heures = '';
      if (t === 'forfait_heures_annuel' && !s.forfaitHeures.trim()) n.forfaitHeures = '1607';
      if (t === 'forfait_jours' && !s.forfaitJours.trim()) n.forfaitJours = '218';
      return n;
    });
    setTouched(true);
  };

  // Sortie enregistrée : sa date et son motif ne changent que par le dialogue de sortie. Sans elle, un CDI n'a pas de date
  // de fin (passage d'un CDD en CDI : la fin du CDD est effacée).
  const sortieEnregistree = !creation && !!initial.motifSortie;
  const tcSaisi = TYPES_CONTRAT[f.typeContrat];
  const finSaisie = sortieEnregistree || !!(tcSaisi?.fin || tcSaisi?.finFacultative || tcSaisi?.interim);
  // Changement d'organisation du temps d'une fiche existante : date d'effet saisie ; sinon la date en vigueur est conservée.
  const saisie = { ...toInput(f, initial.tempsDepuis), motifSortie: initial.motifSortie ?? null, ...(finSaisie ? {} : { fin: null }) };
  const ref0 = normaliserProfil(initial), nv = normaliserProfil(saisie);
  const nouveauRegime = !creation && !limited && REGIME_TEMPS.some(k => nv[k] !== ref0[k]);
  const confirme = !!reutiliser && reutiliser === normaliserMatricule(f.matriculePaie);
  // Manager : le poste du référentiel reste celui du service RH ; seul son intitulé se précise.
  const input: ProfilInput = limited ? { ...initial, poste: f.poste, jourOff: f.jourOff }
    : nouveauRegime ? { ...saisie, tempsDepuis: f.effet || null } : saisie;
  // Un manager d'équipe ne peut pas passer en intérim (équipes encadrées).
  const v = validerProfil(input, {
    equipes: d.equipes, year: d.year, encadre: emp ? d.teamsOf(emp.id) : [], adressesPrises: adressesPrises(d.ds.employes, emp?.id),
    matricules: { pris: matriculesPris(d.ds.employes, d.ti, emp?.id), actuel: initial.matriculePaie, reutiliser: confirme },
    contrat: { finPrevue: emp?.finPrevue ?? null, sortieEnregistree: emp?.sortieEnregistree },
    // Date déjà enregistrée : requise (l'année seule ne la remplace pas). Manager : vue sans la date, que le serveur contrôle.
    naissance: { enregistree: !creation && !!initial.naissanceLe, masquee: limited },
  });
  // Matricule d'un salarié sorti, pas encore confirmé : l'administrateur RH confirme à l'envoi ; pour le gestionnaire RH,
  // l'erreur sous le champ le renvoie à l'administrateur.
  const aConfirmer = !limited && !confirme ? v.matriculeAConfirmer : null;
  const errEffet = !nouveauRegime ? null
    : !f.effet ? 'Date d’effet du nouveau régime de temps requise.'
    : !isValidDate(f.effet) ? null
    : isValidDate(f.entree) && f.effet < f.entree ? 'La date d’effet du nouveau régime précède la date d’entrée.'
    : f.effet > d.ti ? 'Date d’effet future : enregistrez le changement d’organisation du temps le jour de sa prise d’effet.'
    : null;
  // Matricule de paie déjà enregistré : changé ou retiré par l'administrateur RH seul (contrôlé aussi par le serveur).
  const errMatricule = !admin && !limited && initial.matriculePaie && v.profil.matriculePaie !== initial.matriculePaie
    ? `Matricule de paie déjà enregistré (${initial.matriculePaie}) : seul l’administrateur RH le change ou le retire.` : null;
  const errors = [...v.errors.filter(m => !(aConfirmer && admin && /^Matricule de paie de /.test(m))), ...(errEffet ? [errEffet] : []), ...(errMatricule ? [errMatricule] : [])];
  const ok = errors.length === 0;
  // Garde-fou (en attendant l'historique des contrats) : RTT ou jours de repos de l'année pris ou posés que le nouveau régime
  // n'ouvre plus. Le serveur exige la confirmation ; le solde affiché est gardé au journal pour la paie.
  const changeRegime = !creation && !limited && !!emp && JSON.stringify(contratFige(emp)) !== JSON.stringify(contratFige({ ...emp, ...v.profil }));
  const perte = changeRegime && ok ? rttPerdus(d, emp!, { ...emp!, ...v.profil, tempsDepuis: nouveauRegime ? f.effet : emp!.tempsDepuis }) : null;
  const dirty = creation || !same(v.profil, ref0);
  // Erreurs affichées en direct en modification, dès la première saisie en création, et après un envoi bloqué.
  const showErrors = !creation || touched || verif.tente;
  const { champs: errChamp, autres } = repartir(errors);
  const err = (k: keyof Form) => showErrors ? errChamp[k] ?? null : null;
  const partielEmp = !!emp && d.contratOf(emp).partiel;

  const save = async (confirmeRtt = false) => {
    if (busy || !verif.verifier(!ok)) return;
    // Rien de changé : rien à envoyer, le dialogue se ferme.
    if (!dirty) { closeDialog(); notify('Aucune modification à enregistrer'); return; }
    // Matricule de paie d'un salarié sorti : l'administrateur RH confirme la réembauche avant l'envoi.
    if (aConfirmer) { setConfirmer(true); return; }
    await envoyer(confirme, confirmeRtt);
  };
  const envoyer = async (reutiliserMatricule: boolean, confirmeRtt: boolean) => {
    // Changement de régime qui ferme le compteur de RTT de l'année : confirmation d'abord.
    if (perte && !confirmeRtt) { setConfirmer(false); setConfRtt(true); return; }
    setBusy(true);
    let payload: Record<string, unknown>;
    // Modification : seuls les champs modifiés partent (avec les champs qui leur sont liés), accompagnés de leur valeur
    // d'origine (`avant`) ; le serveur refuse si l'un d'eux a changé entre-temps (shared/rules/fiche-concurrente.ts).
    const champs = creation ? PROFIL_FIELDS : champsAEnvoyer(ref0, v.profil, limited ? MANAGER_FIELDS.filter(k => k === 'poste' || partielEmp) : PROFIL_FIELDS)
      // La date d'effet ne concerne qu'un changement d'organisation du temps : sinon le serveur garde la date en vigueur.
      .filter(k => creation || nouveauRegime || k !== 'tempsDepuis');
    payload = creation ? {} : { id: emp!.id };
    champs.forEach(k => { payload[k] = v.profil[k]; });
    if (!creation) payload.avant = Object.fromEntries(champs.map(k => [k, initial[k] ?? null]));
    if (!limited) {
      if (reutiliserMatricule) payload.reutiliserMatricule = true;
      if (perte) payload.confirmerRtt = true;
    }
    const r = await run(creation ? 'employe.creer' : 'employe.modifier', payload);
    setBusy(false);
    setConfirmer(false);
    setConfRtt(false);
    // Fiche modifiée entre-temps par quelqu'un d'autre : rien n'est enregistré, le dialogue reste ouvert et les données
    // sont relues (store.tsx) ; les champs en conflit s'affichent, la fiche à jour se reprend sans perdre les autres saisies.
    if (r.status === 412 && !creation) { setConcurrent((payload.avant as Partial<ProfilInput> | undefined) ?? {}); return; }
    if (!r.ok) return;
    closeDialog();
    const id = (r.result as { id?: number } | undefined)?.id;
    if (creation && id) setUi({ selectedId: id });
  };

  // Modification concurrente refusée (412) : champs modifiés entre-temps, lus dans la fiche relue après le refus.
  const enConflit = concurrent && emp ? champsEnConflit(concurrent, profilOf(emp)) : [];
  const reprendre = () => {
    if (!emp) return;
    const actuelle = profilOf(emp);
    setF(s => reprendreAJour(s, initial, actuelle, d.ti));
    setInitial(actuelle);
    setConcurrent(null);
  };
  // En tête du dialogue, et ciblé dès le refus (le bouton « Enregistrer » est en bas d'un long formulaire).
  const conflitBloc = concurrent && <div ref={conflitRef} tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
    <Bloquant>
      Fiche modifiée entre-temps par une autre personne{enConflit.length ? ` (${enConflit.map(k => LIBELLE_CHAMP_FICHE[k]).join(', ')})` : ''} : rien
      n’a été enregistré.
    </Bloquant>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <Btn small onClick={reprendre}>Reprendre la fiche à jour</Btn>
      <Fine>Les champs modifiés entre-temps prennent leur valeur enregistrée ; vos autres saisies sont gardées. Vérifiez, puis enregistrez de nouveau.</Fine>
    </div>
  </div>;
  // Erreurs sans champ (statut, nature du contrat…) : sous le formulaire, ciblées à l'envoi.
  const messages = <>
    {showErrors && autres.map(m => <Bloquant key={m}>{m}</Bloquant>)}
    {!limited && v.warnings.map(w => <NoteAccent key={w}>{w}</NoteAccent>)}
  </>;
  const actions = <>
    {showErrors && !ok && (
      <span className="form-error" style={{ marginRight: 'auto', alignSelf: 'center' }}>{plural(errors.length, 'point à corriger', 'points à corriger')}</span>
    )}
    <CancelButton />
    <SubmitButton busy={busy}>{creation ? 'Créer la fiche' : 'Enregistrer'}</SubmitButton>
  </>;

  // — Manager : poste et jours non travaillés ; le reste en lecture seule —
  if (limited && emp) {
    const c = d.contratOf(emp);
    const finTxt = emp.fin ? ` · jusqu’au ${fmtIso(emp.fin)}` : '';
    return (
      <Dialog title={`Modifier la fiche — ${emp.nom}`} width={640} tall onSubmit={save} actions={actions}>
        {conflitBloc}
        <div className="grid-2">
          <PosteLibelle emp={emp} poste={f.poste} erreur={err('poste')} onChange={v => set('poste', v)} />
          <Field label="Équipe"><Static pad>{equipeLabel(emp)}</Static></Field>
        </div>
        {partielEmp && (
          <Field label="Jours non travaillés" erreur={err('jourOff')}>
            <JoursOff value={f.jourOff} onChange={j => set('jourOff', j)} />
          </Field>
        )}
        <SectionLabel>Contrat &amp; temps de travail</SectionLabel>
        <div className="grid-2">
          <Field label="Statut"><Static>{STATUTS[c.statut].label} <span className="text-muted">· {c.cadre ? 'cadre' : 'non-cadre'}</span></Static></Field>
          <Field label="Nature du contrat"><Static>{TYPES_CONTRAT[c.typeContrat].label}{finTxt}</Static></Field>
          <Field label="Organisation du temps"><Static>{c.label}{emp.tempsDepuis ? <span className="text-muted"> · depuis le {fmtIso(emp.tempsDepuis)}</span> : null}</Static></Field>
          <Field label="Date d’entrée"><Static>{fmtIso(emp.entree)}</Static></Field>
          {(emp.essaiRenouveleJusquau ?? emp.essaiFin) && (
            <Field label="Période d’essai">
              <Static>jusqu’au {fmtIso((emp.essaiRenouveleJusquau ?? emp.essaiFin)!)}{emp.essaiRenouveleJusquau ? <span className="text-muted"> · renouvelée</span> : null}</Static>
            </Field>
          )}
        </div>
        <Fine>Le contrat, le statut et l’organisation du temps de travail relèvent du service RH.</Fine>
        {messages}
      </Dialog>
    );
  }

  // — RH : fiche complète —
  const tc = TYPES_CONTRAT[f.typeContrat];
  const tt = TEMPS_TRAVAIL[f.temps];
  const st = STATUTS[f.statut];
  const nj = toNum(f.forfaitJours);
  const repos = f.temps === 'forfait_jours' && nj != null && nj >= 1 && nj <= 218 ? reposForfait(d.year, nj) : null;
  const valideur = d.mgrOf({ id: emp?.id ?? -1, equipe: f.equipe || null });
  const regimeActuel = emp ? d.contratOf(emp).label : '';
  // Période d'essai : maximum légal rappelé (aucune durée proposée) et dernier jour pour notifier une rupture.
  const max = essaiMaximum(v.profil);
  const prev = limitePrevenance(v.profil);
  // Borne des dates d'essai : la fin prévue au contrat, jamais la date d'une sortie enregistrée (rupture pendant l'essai).
  const finEssaiMax = (sortieEnregistree || emp?.sortieEnregistree ? emp?.finPrevue : f.fin) || undefined;
  const essaiAide = [
    'L’essai n’existe que s’il est écrit au contrat (art. L1221-23) : saisissez ses dates telles qu’elles y figurent, la convention collective pouvant prévoir moins.',
    max ? `Maximum légal : le ${fmtIso(max.fin)} (${max.texte})${max.renouvele ? `, le ${fmtIso(max.renouvele)} en cas de renouvellement (${max.texteRenouvele}, si un accord de branche étendu le prévoit)` : ''}.` : '',
    prev?.delai ? `Rupture par l’employeur à notifier au plus tard le ${fmtIso(prev.le)} (délai de prévenance de ${prev.delai}, art. L1221-25) : l’alerte des Échéances tombe à cette date.` : '',
  ].filter(Boolean).join(' ');

  return (
    <Dialog title={creation ? 'Nouveau collaborateur' : `Modifier la fiche — ${emp!.nom}`} width={640} tall onSubmit={() => save()} actions={actions}
      confirmation={confirmer && aConfirmer ? {
        texte: `Réembauche : reprendre le matricule de paie ${v.profil.matriculePaie} de ${aConfirmer.nom}, sorti le ${fmtIso(aConfirmer.sortiLe!)} ? Les deux fiches porteront ce matricule ; Sage et Keystone ne reçoivent que la fiche présente.`,
        bouton: 'Réutiliser le matricule', occupe: busy, confirmer: () => { setReutiliser(v.profil.matriculePaie); void envoyer(true, false); }, annuler: () => setConfirmer(false),
      } : confRtt && perte ? {
        texte: `Le nouveau régime n’ouvre ni RTT ni jours de repos : le compteur de ${emp!.nom} (${soldeRttTexte(perte)}) ne sera plus suivi dans Cursus. Ce solde est gardé au journal pour la paie.`,
        bouton: 'Confirmer le changement', occupe: busy, confirmer: () => save(true), annuler: () => setConfRtt(false),
      } : null}>
      {conflitBloc}
      <SectionLabel>Identité</SectionLabel>
      <div className="grid-2">
        <Field label="Nom" htmlFor="emp-nom" requis erreur={err('nom')}>
          <input className="input" id="emp-nom" type="text" autoFocus={creation} placeholder="Prénom Nom" value={f.nom} onChange={ev => set('nom', ev.target.value)} />
        </Field>
        <PosteChoix posteId={f.posteId} poste={f.poste} actuel={initial.posteId ?? null} erreur={err('poste')} onChange={choisirPoste} nouveau />
        <Field label="Équipe" htmlFor="emp-equipe" erreur={err('equipe')}>
          <select className="input" id="emp-equipe" value={f.equipe} onChange={ev => set('equipe', ev.target.value)}>
            <option value="">À affecter</option>
            {d.equipes.map(nom => <option key={nom} value={nom}>{nom}</option>)}
          </select>
          <span className="text-muted sub">Manager valideur : {d.mgrName(valideur)}</span>
        </Field>
        <Field label="Date de naissance" htmlFor="emp-naiss" requis={anneeSeule == null} erreur={err('naissanceLe')}>
          <input className="input" id="emp-naiss" type="date" min="1940-01-01" max={d.ti} value={f.naissanceLe} onChange={ev => set('naissanceLe', ev.target.value)} />
          <span className="text-muted sub">
            {anneeSeule != null && !f.naissanceLe ? `Année connue : ${anneeSeule} ; la date complète donne l’âge exact (salariés mineurs, fin de carrière)`
              : 'Âge exact : règles des salariés mineurs, entretiens de fin de carrière'}
          </span>
        </Field>
        <Field label="Adresse e-mail professionnelle" htmlFor="emp-email">
          <input className="input" id="emp-email" type="email" autoComplete="off" placeholder="prenom.nom@entreprise.fr" value={f.email} onChange={ev => set('email', ev.target.value)} />
          <span className="text-muted sub">Notifications et convocations ; à défaut, celle du compte Microsoft 365 est reprise à sa création</span>
        </Field>
        <Field label="Notifications par e-mail">
          <Static pad>{emp ? MODE_NOTIFICATION_LABEL[emp.notifications] : MODE_NOTIFICATION_LABEL.immediat}<div className="text-muted sub">Réglées par le salarié dans son espace</div></Static>
        </Field>
        <Field label="Matricule de paie" htmlFor="emp-matricule" erreur={err('matriculePaie')}>
          <input className="input" id="emp-matricule" type="text" autoComplete="off" spellCheck={false} maxLength={20} placeholder="004102"
            value={f.matriculePaie} onChange={ev => set('matriculePaie', ev.target.value)} />
          <span className="text-muted sub">
            {aConfirmer && admin ? `Celui de ${aConfirmer.nom}, sorti le ${fmtIso(aConfirmer.sortiLe!)} : réembauche à confirmer à l’enregistrement`
              : 'Dossier de paie Sage : 1 à 20 lettres et chiffres ; à défaut, le salarié est refusé d’une transmission réelle à la paie'}
          </span>
        </Field>
      </div>

      <SectionLabel>Contrat</SectionLabel>
      <div className="grid-2">
        <Field label="Nature du contrat" htmlFor="emp-type" erreur={err('typeContrat')}>
          <select className="input" id="emp-type" value={f.typeContrat} onChange={ev => set('typeContrat', ev.target.value as TypeContrat)}>
            {(Object.keys(TYPES_CONTRAT) as TypeContrat[]).map(k => <option key={k} value={k}>{TYPES_CONTRAT[k].label}</option>)}
          </select>
        </Field>
        <Field label="Date d’entrée" htmlFor="emp-entree" requis erreur={err('entree')}>
          <input className="input" id="emp-entree" type="date" value={f.entree} onChange={ev => set('entree', ev.target.value)} />
        </Field>
        {sortieEnregistree ? (
          <Field label="Sortie">
            <Static pad>{sortieTexte(emp!)}<div className="text-muted sub">Se modifie ou s’annule depuis la fiche (section Contrat)</div></Static>
          </Field>
        ) : (tc.fin || tc.interim || tc.finFacultative) && (
          <Field label={tc.interim ? 'Fin de mission prévue (facultatif)' : tc.finFacultative ? 'Date de fin (facultatif)' : 'Date de fin'} htmlFor="emp-fin" requis={!!tc.fin} erreur={err('fin')}>
            <input className="input" id="emp-fin" type="date" min={f.entree || undefined} value={f.fin} onChange={ev => set('fin', ev.target.value)} />
          </Field>
        )}
        {tc.interim && (
          <Field label="Agence d’intérim" htmlFor="emp-agence" requis erreur={err('agence')}>
            <input className="input" id="emp-agence" type="text" value={f.agence} onChange={ev => set('agence', ev.target.value)} />
          </Field>
        )}
      </div>

      <SectionLabel>Période d’essai</SectionLabel>
      <div className="grid-2">
        <Field label="Fin de la période d’essai" htmlFor="emp-essai" erreur={err('essaiFin')}>
          <input className="input" id="emp-essai" type="date" min={f.entree || undefined} max={finEssaiMax} value={f.essaiFin} onChange={ev => set('essaiFin', ev.target.value)} />
          <span className="text-muted sub">Date écrite au contrat ; vide s’il n’en prévoit pas</span>
        </Field>
        <Field label="Renouvelée jusqu’au" htmlFor="emp-essai-ren" erreur={err('essaiRenouvele')}>
          <input className="input" id="emp-essai-ren" type="date" min={f.essaiFin || undefined} max={finEssaiMax} value={f.essaiRenouvele} onChange={ev => set('essaiRenouvele', ev.target.value)} />
          <span className="text-muted sub">Accord écrit du salarié pendant l’essai initial</span>
        </Field>
      </div>
      <Fine>{essaiAide}</Fine>

      <SectionLabel>Statut</SectionLabel>
      <Seg name="emp-statut" label="Statut" value={f.statut} onChange={s => set('statut', s)}
        options={(Object.keys(STATUTS) as Statut[]).map(k => [k, STATUTS[k].court] as [Statut, string])} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }} />
      <Fine>{st.label} — {st.cadre ? 'cadre' : 'non-cadre'} au sens de la CCN Industries chimiques.</Fine>

      <SectionLabel>Temps de travail</SectionLabel>
      <div className="grid-2">
        <Field label="Organisation du temps" htmlFor="emp-temps" erreur={err('temps')}>
          <select className="input" id="emp-temps" value={f.temps} onChange={ev => setTemps(ev.target.value as TempsTravail)}>
            {(Object.keys(TEMPS_TRAVAIL) as TempsTravail[]).map(k => <option key={k} value={k}>{TEMPS_TRAVAIL[k].label}</option>)}
          </select>
          {!nouveauRegime && initial.tempsDepuis && <span className="text-muted sub">En vigueur depuis le {fmtIso(initial.tempsDepuis)}</span>}
        </Field>
        {(f.temps === 'partiel' || f.temps === 'forfait_heures_hebdo') && (
          <Field label="Durée hebdomadaire (heures)" htmlFor="emp-heures" requis erreur={err('heures')}>
            <input className="input" id="emp-heures" type="text" inputMode="decimal" placeholder={f.temps === 'partiel' ? '28' : '38,5'} value={f.heures} onChange={ev => set('heures', ev.target.value)} />
          </Field>
        )}
        {f.temps === 'forfait_heures_annuel' && (
          <Field label="Durée annuelle (heures)" htmlFor="emp-fh" requis erreur={err('forfaitHeures')}>
            <input className="input" id="emp-fh" type="text" inputMode="numeric" placeholder="1607" value={f.forfaitHeures} onChange={ev => set('forfaitHeures', ev.target.value)} />
          </Field>
        )}
        {f.temps === 'forfait_jours' && (
          <Field label="Jours travaillés par an" htmlFor="emp-fj" requis erreur={err('forfaitJours')}>
            <input className="input" id="emp-fj" type="text" inputMode="numeric" placeholder="218" value={f.forfaitJours} onChange={ev => set('forfaitJours', ev.target.value)} />
            {repos != null && <span className="text-muted sub">Soit {plural(repos, 'jour de repos', 'jours de repos')} en {d.year}</span>}
          </Field>
        )}
        {nouveauRegime && (
          <Field label="Date d’effet" htmlFor="emp-effet" requis erreur={err('effet')}>
            <input className="input" id="emp-effet" type="date" min={f.entree || undefined} max={d.ti} value={f.effet} onChange={ev => set('effet', ev.target.value)} />
          </Field>
        )}
      </div>
      {nouveauRegime && (
        <Fine>
          Les semaines antérieures {isValidDate(f.effet) ? `au ${fmtIso(f.effet)}` : 'à la date d’effet'} restent calculées avec l’ancien régime ({regimeActuel}) :
          celles des {SEMAINES_FIGEES} dernières qui n’ont pas encore de feuille de temps en reçoivent une, vide, figée sur ce régime.
          Les RTT et jours de repos sont proratisés à partir de cette date.
        </Fine>
      )}
      {f.temps === 'partiel' && (
        <Field label="Jours non travaillés" erreur={err('jourOff')}>
          <JoursOff value={f.jourOff} onChange={j => set('jourOff', j)} />
        </Field>
      )}
      <Fine>{tt.aide}{tt.article ? ` (${tt.article})` : ''}</Fine>

      <SectionLabel>Suivi</SectionLabel>
      <div className="grid-2">
        {/* Fiche existante : une nouvelle visite s'enregistre avec l'avis du médecin du travail (bouton de la fiche). */}
        {creation ? (
          <Field label="Dernière visite d’aptitude médicale" htmlFor="emp-visite" erreur={err('visite')}>
            <input className="input" id="emp-visite" type="date" max={d.ti} value={f.visite} onChange={ev => set('visite', ev.target.value)} />
            <span className="text-muted sub">Avis « apte » ; un autre avis s’enregistre ensuite sur la fiche.</span>
          </Field>
        ) : (
          <Field label="Dernière visite d’aptitude médicale">
            <Static pad>{emp?.visite ? `${fmtIso(emp.visite)} · ${AVIS_MEDICAL[emp.avis ?? 'apte'].court}` : 'Non renseignée'}</Static>
            <span className="text-muted sub">Nouvelle visite : « Avis du médecin du travail » sur la fiche.</span>
          </Field>
        )}
        <div />
        <Field label="Reprise après absence longue — motif" htmlFor="emp-rmotif" requis={!!f.repriseDate} erreur={err('repriseMotif')}>
          {/* Liste fermée (art. L6315-1), sans texte libre : aucune information médicale sur la fiche. */}
          <select className="input" id="emp-rmotif" value={f.repriseMotif} onChange={ev => set('repriseMotif', ev.target.value)}>
            <option value="">Aucune reprise</option>
            {MOTIFS_REPRISE.map(m => <option key={m} value={m}>{cap(m)}</option>)}
          </select>
        </Field>
        <Field label="Date de reprise" htmlFor="emp-rdate" erreur={err('repriseDate')}>
          <input className="input" id="emp-rdate" type="date" value={f.repriseDate} onChange={ev => set('repriseDate', ev.target.value)} />
        </Field>
      </div>
      <Fine>
        La date de reprise déclenche la proposition d’un entretien de parcours professionnel (art. L6315-1).
        Elle est renseignée automatiquement à la fin d’une maternité, d’une adoption, d’un congé parental ou d’un arrêt longue maladie
        saisi dans Congés &amp; absences ; à saisir ici pour une absence antérieure à Cursus.
        Le motif se choisit dans la liste, sans information médicale : un arrêt longue maladie s’inscrit « absence longue ».
        Il reste réservé au service RH : le manager ne voit que la mention « absence longue ».
      </Fine>

      {messages}
    </Dialog>
  );
}
