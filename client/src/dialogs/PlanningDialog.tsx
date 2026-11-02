// Planning d'équipe (lot 12, chantier C5, étape 2) : dialogues de l'onglet Planning d'équipe de Temps de travail et de
// « Mon planning ». Le serveur refait chaque contrôle (server/src/actions/planning.ts) : l'écran montre ce qu'il va
// décider (aperçu sur l'instantané : shared/rules/planning-apercu.ts), le bouton principal n'est jamais grisé et la saisie
// incomplète se signale à l'envoi.
// - Générer : période (12 semaines au plus, à partir d'aujourd'hui) ; brouillons d'après les affectations au roulement.
// - Publier : brouillons de la période, refus (habilitation absente, retirée ou suspendue ; nuit d'un mineur ; semaine
//   validée), alertes à motiver (repos, durées, habilitation qui expire, formation, réserve d'aptitude neutre), créneaux
//   communiqués sous le délai de prévenance (motif des circonstances exceptionnelles, communiqué au salarié, jamais
//   journalisé) ; informations sans motif (étape 3 : conflits avec une mission ou une tâche Keystone, une session, une
//   astreinte ; postes sous la couverture minimale de l'équipe).
// - Créneau : ajout (poste nominatif ou à pourvoir), modification de l'horaire (repos compris), retrait d'un brouillon,
//   annulation d'un poste publié (motif communiqué au salarié).
// - Roulement : affectation d'un salarié à un cycle (groupe, période), fin d'une affectation (motif jamais journalisé).
// - Échange : le salarié propose à un collègue de son équipe de lui céder son poste, ou de l'échanger contre un poste publié
//   du collègue (visible seulement si le réglage `planningCollegues` l'ouvre) ; le valideur le valide, contrôles recalculés.
// - Reprise : équipes par quart reprises en groupes d'un cycle (shared/rules/planning-reprise.ts).
import { useMemo, useState } from 'react';
import { addD, mondayOf } from '../../../shared/dates.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { cycleDe, cyclesEnVigueur, horaireDuCycle } from '../../../shared/rules/cycles.ts';
import { horairesEnVigueur, horaireTexte } from '../../../shared/rules/horaires.ts';
import { apercuEchange, apercuPublication } from '../../../shared/rules/planning-apercu.ts';
import { creneauCouvertureTexte } from '../../../shared/rules/couverture-creneaux.ts';
import { controlerRoulement, debutCreneau, fenetrePlanning, MOTIF_PLANNING_MAX, refusHorizon, refusPeriode, SEMAINES_A_VENIR, SEMAINES_MAX } from '../../../shared/rules/planning.ts';
import { type AlertePlanning, instantParis } from '../../../shared/rules/planning-controles.ts';
import { equipesParQuart, proposerReprise } from '../../../shared/rules/planning-reprise.ts';
import type { ISODate } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { jourCourt, jourLong, posteTexte } from '../components/planning/planning-vue.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Texte d'une alerte, avec le salarié. */
const ligneAlerte = (nom: (id: number) => string, a: AlertePlanning) => `${nom(a.empId)} — ${a.texte}`;

/** Zone de motif (circonstances exceptionnelles, alertes, annulation). */
function Motif({ id, label, valeur, onChange, requis, erreur, aide, placeholder }: {
  id: string; label: string; valeur: string; onChange: (v: string) => void; requis: boolean; erreur: string | null; aide: string; placeholder: string;
}) {
  return (
    <Field label={<>{label}{!requis && <span className="who"> · facultatif</span>}</>} htmlFor={id} requis={requis} erreur={erreur}>
      <textarea className="input short" id={id} rows={2} maxLength={MOTIF_PLANNING_MAX + 20} value={valeur} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{ resize: 'vertical' }} />
      <span className="text-muted sub">{aide}</span>
    </Field>
  );
}

/** Erreur d'un motif saisi : vide alors qu'il est exigé, ou trop long. */
const erreurMotif = (v: string, requis: boolean, vide: string) => (requis && !v.trim() ? vide : v.trim().length > MOTIF_PLANNING_MAX ? `${MOTIF_PLANNING_MAX} caractères au plus.` : null);

/** Refus du serveur qui exige le motif des circonstances exceptionnelles (délai de prévenance). */
export const motifExige = (erreur: string | null | undefined) => !!erreur && /délai de prévenance/.test(erreur) && /circonstances exceptionnelles/.test(erreur);
/** Refus du serveur qui exige le motif des alertes acceptées. */
export const alertesExigees = (erreur: string | null | undefined) => !!erreur && /alertes à motiver/.test(erreur);

// — Générer —

export function PlanningGenererDialog({ equipe, du: duPropose }: { equipe: string; du?: ISODate | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const lundi = mondayOf(addD(d.ti, 7));
  const [du, setDu] = useState(duPropose && duPropose >= d.ti ? duPropose : lundi);
  const [au, setAu] = useState(addD(duPropose && duPropose >= d.ti ? duPropose : lundi, 27));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const refus = DATE.test(du) && DATE.test(au) ? refusPeriode(du, au) ?? refusHorizon(au, d.ti) : 'Indiquez le premier et le dernier jour.';
  const passe = !refus && au < d.ti ? 'Période passée : un jour passé se corrige sur la feuille de temps.' : null;
  const max = fenetrePlanning(d.ti).au;
  const affectes = (d.ds.roulements ?? []).filter(r => r.equipe === equipe && r.du <= au && (!r.au || r.au >= du) && !(r.au && r.au < r.du));
  const envoyer = async () => {
    if (busy || !v.verifier(refus, passe)) return;
    setBusy(true);
    const r = await run('planning.generer', { equipe, du, au });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={`Générer le planning — ${equipe}`} width={520} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Générer en brouillon</SubmitButton></>}>
      <div className="grid-2">
        <Field label="Premier jour" htmlFor="gen-du" requis erreur={v.erreur(refus && !DATE.test(du) ? refus : null)}>
          <input className="input" id="gen-du" type="date" value={du} min={d.ti} max={max} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label="Dernier jour" htmlFor="gen-au" requis erreur={v.erreur((DATE.test(du) && refus) || passe)}>
          <input className="input" id="gen-au" type="date" value={au} min={du || undefined} max={max} onChange={e => setAu(e.target.value)} />
        </Field>
      </div>
      <Fine muted={false}>
        {affectes.length
          ? `${plural(new Set(affectes.map(r => r.empId)).size, 'salarié affecté', 'salariés affectés')} au roulement de l’équipe sur la période.`
          : 'Aucun salarié de l’équipe n’est affecté à un cycle sur cette période : affectez-les d’abord (Affectations au roulement).'}
      </Fine>
      <Fine>
        {SEMAINES_MAX} semaines au plus, à partir d’aujourd’hui et jusqu’au {fmtIso(max)} ({SEMAINES_A_VENIR} semaines à venir). Les créneaux sont créés en brouillon, d’après le cycle et le groupe de chacun ; un jour férié
        chômé devient un repos, sauf dérogation au repos dominical de l’équipe. Un créneau publié ou corrigé à la main n’est jamais remplacé. Rien n’est
        communiqué avant la publication.
      </Fine>
    </Dialog>
  );
}

// — Publier —

export function PlanningPublierDialog({ equipe, du, au }: { equipe: string; du: ISODate; au: ISODate }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const [debut, setDebut] = useState(du < d.ti ? d.ti : du);
  const [fin, setFin] = useState(au);
  const [motif, setMotif] = useState('');
  const [motifAlertes, setMotifAlertes] = useState('');
  // Motifs exigés par le serveur alors que l'aperçu ne voit ni alerte ni délai court (instantané en retard sur la base) :
  // le champ s'affiche quand même, pour que le planificateur puisse le saisir.
  const [exiges, setExiges] = useState({ motif: false, alertes: false });
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const refus = DATE.test(debut) && DATE.test(fin) ? refusPeriode(debut, fin) ?? refusHorizon(fin, d.ti) : 'Indiquez le premier et le dernier jour.';
  const a = useMemo(() => (refus ? null : apercuPublication(d, equipe, debut, fin)), [d, equipe, debut, fin, refus]);
  const nom = (id: number) => d.personName(id);
  const vide = !!a && !a.brouillons.length ? 'Aucun brouillon à publier sur cette période : générez le planning ou modifiez un créneau d’abord.' : null;
  const bloque = a && (a.verrou.length || a.alertes.refus.length) ? 'Publication impossible : corrigez d’abord les refus ci-dessus.' : null;
  const avecMotif = !!a && (a.horsDelai.length > 0 || exiges.motif), avecAlertes = !!a && (a.alertes.alertes.length > 0 || exiges.alertes);
  const eMotif = a ? erreurMotif(motif, avecMotif, 'Indiquez les circonstances exceptionnelles qui justifient le délai court.') : null;
  const eAlertes = a ? erreurMotif(motifAlertes, avecAlertes, 'Indiquez pourquoi le planning est publié malgré les alertes.') : null;
  const envoyer = async () => {
    if (busy || !v.verifier(refus, vide, bloque, eMotif, eAlertes)) return;
    setBusy(true);
    const r = await run('planning.publier', { equipe, du: debut, au: fin, motif: motif.trim(), motifAlertes: motifAlertes.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
    else setExiges(x => ({ motif: x.motif || motifExige(r.error), alertes: x.alertes || alertesExigees(r.error) }));
  };
  return (
    <Dialog title={`Publier le planning — ${equipe}`} width={640} tall onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Publier</SubmitButton></>}>
      <div className="grid-2">
        <Field label="Premier jour" htmlFor="pub-du" requis erreur={v.erreur(!DATE.test(debut) ? refus : null)}>
          <input className="input" id="pub-du" type="date" value={debut} min={d.ti} onChange={e => setDebut(e.target.value)} />
        </Field>
        <Field label="Dernier jour" htmlFor="pub-au" requis erreur={v.erreur(DATE.test(debut) ? refus : null)}>
          <input className="input" id="pub-au" type="date" value={fin} min={debut || undefined} onChange={e => setFin(e.target.value)} />
        </Field>
      </div>
      {a && <>
        <Fine muted={false}>
          {a.brouillons.length
            ? `${plural(a.brouillons.length, 'créneau à publier', 'créneaux à publier')} pour ${plural(a.salaries.length, 'salarié', 'salariés')}${a.brouillons.some(c => c.empId == null) ? ' (postes à pourvoir compris)' : ''} : chacun reçoit aussitôt un e-mail, et une notification s’il l’a choisie.`
            : 'Aucun brouillon sur cette période.'}
        </Fine>
        {(a.verrou.length > 0 || a.alertes.refus.length > 0) && (
          <div role="group" aria-label="Refus">
            <Controles msgs={[...a.verrou, ...a.alertes.refus.map(x => ligneAlerte(nom, x))].map(text => ({ text, bad: true }))} />
          </div>
        )}
        {avecMotif && <>
          {a.horsDelai.length > 0 && (
            <Fine muted={false}>
              {plural(a.horsDelai.length, 'créneau communiqué', 'créneaux communiqués')} moins de {a.delai} jours avant leur date (dès le {fmtIso(a.horsDelai[0].jour)}) : délai de
              prévenance non tenu.
            </Fine>
          )}
          <Motif id="pub-motif" label="Circonstances exceptionnelles" valeur={motif} onChange={setMotif} requis erreur={v.erreur(eMotif)}
            aide="Communiqué aux salariés concernés dans l’e-mail ; gardé sur le créneau, jamais recopié au journal. N’y indiquez aucune information médicale."
            placeholder="Remplacement d’un salarié absent, panne d’une ligne…" />
        </>}
        {avecAlertes && <>
          <div role="group" aria-label="Alertes à motiver">
            <Controles msgs={a.alertes.alertes.slice(0, 12).map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />
            {a.alertes.alertes.length > 12 && <Fine>Et {a.alertes.alertes.length - 12} autre{a.alertes.alertes.length - 12 > 1 ? 's' : ''}.</Fine>}
          </div>
          <Motif id="pub-alertes" label="Motif des alertes acceptées" valeur={motifAlertes} onChange={setMotifAlertes} requis erreur={v.erreur(eAlertes)}
            aide="Gardé sur les créneaux en cause, vu du planificateur et du service RH seulement ; jamais recopié au journal (seul le nombre d’alertes l’est)."
            placeholder="Repos compensateur accordé, recyclage planifié la semaine prochaine…" />
        </>}
        {a.alertes.infos.length > 0 && <Controles msgs={a.alertes.infos.slice(0, 12).map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />}
        {a.alertes.infos.length > 12 && <Fine>Et {a.alertes.infos.length - 12} autre{a.alertes.infos.length - 12 > 1 ? 's' : ''} information{a.alertes.infos.length - 12 > 1 ? 's' : ''}.</Fine>}
        {/* lot 12 — C5 étape 3 : couverture minimale par créneau après la publication, en information. */}
        {a.couverture.length > 0 && (
          <div role="group" aria-label="Couverture minimale par poste">
            <Controles msgs={a.couverture.slice(0, 8).map(x => ({ text: `Couverture ${jourCourt(x.jour)} — ${creneauCouvertureTexte(x, f => d.fm(f)?.court ?? f)} : sous le minimum`, bad: false }))} />
            {a.couverture.length > 8 && <Fine>Et {a.couverture.length - 8} autre{a.couverture.length - 8 > 1 ? 's' : ''} poste{a.couverture.length - 8 > 1 ? 's' : ''} sous le minimum.</Fine>}
          </div>
        )}
        {v.tente && (vide || bloque) && <Bloquant>{vide ?? bloque}</Bloquant>}
      </>}
      <Fine>
        Délai de prévenance de {a?.delai ?? 7} jours, compté depuis l’e-mail envoyé aujourd’hui (jamais depuis la notification sur téléphone, retardée la nuit et le
        week-end). Une semaine dont la feuille de temps est validée n’est jamais publiée. Aperçu calculé sur votre écran : Cursus refait chaque contrôle à l’envoi.
      </Fine>
    </Dialog>
  );
}

// — Créneau —

/** Annulation d'un poste publié : motif communiqué au salarié, jamais journalisé. */
export const annulationCreneau = (id: number, qui: string, jour: ISODate): Confirmation => ({
  titre: 'Annuler le poste', question: `Annuler le poste du ${fmtIso(jour)} (${qui}) ?`, bouton: 'Annuler le poste', action: 'planning.creneau.annuler', payload: { id },
  suites: ['Le salarié est prévenu aussitôt par e-mail, avec le motif.', 'Le poste reste dans le registre des versions publiées (inspection du travail).'],
  motif: { label: 'Motif de l’annulation', requis: true, aide: `Communiqué à ${qui} ; jamais recopié au journal. N’y indiquez aucune information médicale.`, placeholder: 'Arrêt de la ligne, réorganisation…' },
});

export function PlanningCreneauDialog({ equipe, jour, empId, id }: { equipe: string; jour: ISODate; empId: number | null; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog, openDialog } = useStore();
  const tous = [...d.ds.creneaux ?? [], ...d.ds.creneauxAPourvoir ?? []];
  const [c] = useState(() => (id != null ? tous.find(x => x.id === id) ?? null : null));
  // Créneau publié qui a déjà une modification en brouillon : c'est elle qu'on corrige.
  const enCours = c && c.statut === 'publie' ? tous.find(x => x.remplaceId === c.id && x.statut === 'brouillon') ?? null : null;
  const [horaire, setHoraire] = useState((enCours ?? c)?.horaire ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const qui = empId != null ? d.personName(empId) : 'poste à pourvoir';
  const horaires = horairesEnVigueur(d.ds.referentiels);
  const disparu = id != null && !c;
  const passe = jour < d.ti;
  // Jour au-delà des 12 semaines à venir : aucun poste ne s'y ajoute (le serveur le refuse aussi).
  const loin = !c && !passe ? refusHorizon(jour, d.ti) : null;
  const eHoraire = !horaire && (empId == null || !c) ? 'Choisissez l’horaire du poste.' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(eHoraire, disparu, passe ? 'Jour passé : il se corrige sur la feuille de temps.' : null, loin)) return;
    setBusy(true);
    const r = c ? await run('planning.creneau.modifier', { id: c.id, horaire }) : await run('planning.creneau.ajouter', { equipe, jour, horaire, ...(empId != null ? { empId } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  const retirer = async () => {
    if (!c || busy) return;
    setBusy(true);
    const r = await run('planning.creneau.annuler', { id: c.id });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title={c ? `Poste du ${jourCourt(jour)} — ${qui}` : `Ajouter un poste — ${qui}`} width={520} onSubmit={envoyer}
      actions={disparu || passe || loin ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>{c ? 'Enregistrer' : 'Ajouter en brouillon'}</SubmitButton></>}>
      {disparu ? <Bloquant>Ce créneau n’existe plus.</Bloquant> : <>
        <Static>{jourLong(jour)} · équipe {equipe}</Static>
        {c && <Fine muted={false}>{c.statut === 'publie' ? `Publié (version ${c.version ?? 1}) : ${posteTexte(c)}.` : `Brouillon : ${posteTexte(c)}.`}{enCours ? ` Modification à publier : ${posteTexte(enCours)}.` : ''}</Fine>}
        {passe ? <Fine muted={false}>Jour passé : le poste réellement tenu se déclare et se corrige sur la feuille de temps.</Fine> : loin ? <Fine muted={false}>{loin}.</Fine> : <>
          <Field label="Horaire" htmlFor="cren-horaire" requis={empId == null || !c} erreur={v.erreur(eHoraire)}>
            <select className="input" id="cren-horaire" value={horaire} onChange={e => setHoraire(e.target.value)} autoFocus>
              <option value="">{empId != null && c ? 'Repos' : 'Choisir…'}</option>
              {horaires.map(h => <option key={h.code} value={h.code}>{horaireTexte(h)}</option>)}
            </select>
          </Field>
          {c?.statut === 'publie' && <Fine>Un poste publié ne change pas tout de suite : la nouvelle version est un brouillon, communiquée à sa publication (délai de prévenance, ou motif).</Fine>}
          {c && (
            <div className="actions-end">
              {c.statut === 'brouillon'
                ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void retirer(); }}>Retirer le brouillon</button>
                : <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openDialog({ type: 'confirmer', c: annulationCreneau(c.id, qui, jour) })}>Annuler le poste publié…</button>}
            </div>
          )}
        </>}
      </>}
    </Dialog>
  );
}

// — Roulement —

export function PlanningRoulementDialog({ equipe, empId, id }: { equipe: string; empId?: number | null; id?: number | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const existant = id != null ? (d.ds.roulements ?? []).find(r => r.id === id) ?? null : null;
  const membres = d.ds.employes.filter(e => e.equipe === equipe && (!e.fin || e.fin >= d.ti)).sort((a, b) => a.nom.localeCompare(b.nom));
  const [sel, setSel] = useState<number | null>(existant?.empId ?? empId ?? null);
  const cycles = cyclesEnVigueur(d.ds.cycles);
  const [cycle, setCycle] = useState(existant?.cycle ?? cycles[0]?.code ?? '');
  const [groupe, setGroupe] = useState(existant?.groupe ?? cycleDe(d.ds.cycles, cycles[0]?.code)?.groupes[0]?.code ?? '');
  const [du, setDu] = useState(existant?.du ?? mondayOf(addD(d.ti, 7)));
  const [au, setAu] = useState(existant?.au ?? '');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (id != null && !existant) return <Dialog title="Affectation au roulement" width={460} actions={<CancelButton label="Fermer" />}><Bloquant>Cette affectation n’existe plus.</Bloquant></Dialog>;
  const emp = sel != null ? d.emp(sel) : undefined;
  const c = cycleDe(d.ds.cycles, cycle);
  if (existant) {
    const eAu = !DATE.test(au) ? 'Indiquez le dernier jour de l’affectation.' : au < addD(existant.du, -1) ? 'Au plus tôt la veille du début (affectation annulée).' : existant.au && au > existant.au ? `L’affectation finit déjà le ${fmtIso(existant.au)}.` : null;
    const terminer = async () => {
      if (busy || !v.verifier(eAu, erreurMotif(motif, false, ''))) return;
      setBusy(true);
      const r = await run('planning.roulement.terminer', { id: existant.id, au, motif: motif.trim() });
      setBusy(false);
      if (r.ok) closeDialog();
    };
    return (
      <Dialog title={`Terminer l’affectation — ${d.personName(existant.empId)}`} width={520} onSubmit={terminer} actions={<><CancelButton /><SubmitButton busy={busy}>Terminer l’affectation</SubmitButton></>}>
        <Static>Cycle {existant.cycle}, groupe {existant.groupe}, depuis le {fmtIso(existant.du)}{existant.au ? ` jusqu’au ${fmtIso(existant.au)}` : ''}</Static>
        <Field label="Dernier jour" htmlFor="rou-fin" requis erreur={v.erreur(eAu)}>
          <input className="input" id="rou-fin" type="date" value={au} onChange={e => setAu(e.target.value)} autoFocus />
        </Field>
        <Motif id="rou-motif" label="Motif" valeur={motif} onChange={setMotif} requis={false} erreur={v.erreur(erreurMotif(motif, false, ''))}
          aide="Vu du planificateur et du service RH ; jamais recopié au journal." placeholder="Changement de poste, passage en journée…" />
        <Fine>Les créneaux déjà générés après cette date restent à corriger sur la grille.</Fine>
      </Dialog>
    );
  }
  const r = emp ? controlerRoulement({ cycle, groupe, du, au }, emp, d.ds.cycles ?? [], d.ds.roulements ?? []) : null;
  const eEmp = !emp ? 'Choisissez le salarié.' : null;
  const e = r?.erreurs ?? {};
  const envoyer = async () => {
    if (busy || !v.verifier(eEmp, e.cycle, e.groupe, e.du, e.au, e.general)) return;
    setBusy(true);
    const x = await run('planning.roulement.affecter', { empId: sel, cycle, groupe, du, au: au || null });
    setBusy(false);
    if (x.ok) closeDialog();
  };
  const apercu = c && groupe && DATE.test(du) ? Array.from({ length: 7 }, (_, i) => addD(du, i)).map(j => `${jourCourt(j)} ${horaireDuCycle(c, groupe, j) ?? 'repos'}`).join(' · ') : null;
  return (
    <Dialog title={`Affecter au roulement — ${equipe}`} width={560} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Affecter</SubmitButton></>}>
      <Field label="Salarié" htmlFor="rou-emp" requis erreur={v.erreur(eEmp)}>
        <select className="input" id="rou-emp" value={sel ?? ''} onChange={x => setSel(x.target.value ? Number(x.target.value) : null)} autoFocus>
          <option value="">Choisir…</option>
          {membres.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Cycle" htmlFor="rou-cycle" requis erreur={v.erreur(e.cycle)}>
          <select className="input" id="rou-cycle" value={cycle} onChange={x => { setCycle(x.target.value); setGroupe(cycleDe(d.ds.cycles, x.target.value)?.groupes[0]?.code ?? ''); }}>
            {cycles.map(y => <option key={y.code} value={y.code}>{y.code} · {y.nom}</option>)}
          </select>
        </Field>
        <Field label="Groupe" htmlFor="rou-groupe" requis erreur={v.erreur(e.groupe)}>
          <select className="input" id="rou-groupe" value={groupe} onChange={x => setGroupe(x.target.value)}>
            {(c?.groupes ?? []).map(g => <option key={g.code} value={g.code}>{g.code} (décalage {g.decalage} j)</option>)}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="À partir du" htmlFor="rou-du" requis erreur={v.erreur(e.du)}>
          <input className="input" id="rou-du" type="date" value={du} onChange={x => setDu(x.target.value)} />
        </Field>
        <Field label={<>Jusqu’au<span className="who"> · facultatif</span></>} htmlFor="rou-au" erreur={v.erreur(e.au)}>
          <input className="input" id="rou-au" type="date" value={au} min={du || undefined} onChange={x => setAu(x.target.value)} />
        </Field>
      </div>
      {apercu && <Fine muted={false}>Première semaine : {apercu}.</Fine>}
      {v.tente && e.general && <Bloquant>{e.general}</Bloquant>}
      <Fine>L’équipe hiérarchique ne change pas. Les créneaux se génèrent ensuite en brouillon (Générer), puis se publient.</Fine>
    </Dialog>
  );
}

// — Échanges —

/** Instant présent, en minutes réelles à l'heure de Paris (expiration d'un échange ; « Échanger… » de Mon planning). */
export const maintenant = (ti: ISODate) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return instantParis(ti, `${p.hour}:${p.minute}`);
};

export function PlanningEchangeDialog({ creneauId }: { creneauId: number }) {
  const d = useDomain();
  const { me } = useRole();
  const { run, closeDialog } = useStore();
  const a = (d.ds.creneaux ?? []).find(c => c.id === creneauId && c.empId === me && c.statut === 'publie') ?? null;
  const collegues = d.ds.annuaire.filter(p => a && p.equipe === a.equipe && p.id !== me).sort((x, y) => x.nom.localeCompare(y.nom));
  const [partenaire, setPartenaire] = useState<number | null>(null);
  const [contre, setContre] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const leurs = (d.ds.creneaux ?? []).filter(c => c.empId === partenaire && c.statut === 'publie' && c.horaire && c.jour >= d.ti).sort((x, y) => x.jour.localeCompare(y.jour));
  const commence = a ? debutCreneau(a) <= maintenant(d.ti) : false;
  const ePartenaire = !partenaire ? 'Choisissez le collègue.' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(!a ? 'Poste introuvable.' : null, commence ? 'Poste commencé ou passé : il ne s’échange plus.' : null, ePartenaire)) return;
    setBusy(true);
    const r = await run('planning.echange.proposer', { creneauId, partenaireId: partenaire, ...(contre ? { creneauPartenaire: contre } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title="Proposer un échange de poste" width={520} onSubmit={envoyer}
      actions={!a || commence ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>Proposer l’échange</SubmitButton></>}>
      {!a ? <Bloquant>Ce poste n’est plus publié.</Bloquant> : commence ? <Bloquant>Poste commencé ou passé : il ne s’échange plus.</Bloquant> : <>
        <Static>Votre poste du {jourLong(a.jour)} : {posteTexte(a)}</Static>
        <Field label="Collègue" htmlFor="ech-collegue" requis erreur={v.erreur(ePartenaire)}>
          <select className="input" id="ech-collegue" value={partenaire ?? ''} onChange={e => { setPartenaire(e.target.value ? Number(e.target.value) : null); setContre(null); }} autoFocus>
            <option value="">Choisir…</option>
            {collegues.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </Field>
        {partenaire != null && (leurs.length
          ? (
            <Field label="En échange de" htmlFor="ech-contre">
              <select className="input" id="ech-contre" value={contre ?? ''} onChange={e => setContre(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Rien : je lui cède mon poste</option>
                {leurs.map(c => <option key={c.id} value={c.id}>{jourCourt(c.jour)} · {posteTexte(c)}</option>)}
              </select>
            </Field>
          )
          : <Fine muted={false}>Vous lui proposez de reprendre votre poste (cession). Pour un échange contre l’un de ses postes, voyez-le avec lui : il peut vous le proposer à son tour.</Fine>)}
        <Fine>Votre collègue accepte ou refuse, puis votre manager valide : le repos et les habilitations de chacun sont contrôlés à la validation. L’échange expire si un des postes commence avant.</Fine>
      </>}
    </Dialog>
  );
}

/** Refus d'un échange : motif facultatif, montré aux deux salariés. */
export const refusEchange = (id: number, noms: string): Confirmation => ({
  titre: 'Refuser l’échange', question: `Refuser l’échange de poste (${noms}) ?`, bouton: 'Refuser', action: 'planning.echange.refuser', payload: { id },
  suites: ['Chacun est prévenu ; les postes restent comme publiés.'],
  motif: { label: 'Motif', requis: false, aide: 'Montré aux salariés concernés ; jamais recopié au journal. N’y indiquez aucune information médicale.', placeholder: 'Effectif du poste de nuit insuffisant…' },
});

export function PlanningEchangeValiderDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog, openDialog } = useStore();
  const e = (d.ds.echangesPoste ?? []).find(x => x.id === id) ?? null;
  const a = useMemo(() => (e ? apercuEchange(d, e) : null), [d, e]);
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!e || e.statut !== 'accepte') return <Dialog title="Échange de poste" width={460} actions={<CancelButton label="Fermer" />}><Bloquant>Cet échange n’est plus à valider.</Bloquant></Dialog>;
  const nom = (i: number) => d.personName(i);
  const creneaux = d.ds.creneaux ?? [];
  const ca = creneaux.find(c => c.id === e.creneauDemandeur), cb = e.creneauPartenaire ? creneaux.find(c => c.id === e.creneauPartenaire) : null;
  const eMotif = a ? erreurMotif(motif, a.alertes.alertes.length > 0, 'Indiquez pourquoi l’échange est validé malgré les alertes.') : null;
  // Poste modifié ou annulé depuis : le serveur annule l'échange (envoi permis) ; tout autre refus bloque.
  const bloque = a?.alertes.refus.length ? 'Validation impossible : un des salariés tombe en refus.'
    : a?.refus && !/modifié ou annulé/.test(a.refus) ? `Validation impossible : ${a.refus}.` : null;
  const envoyer = async () => {
    if (busy || !v.verifier(eMotif, bloque)) return;
    setBusy(true);
    const r = await run('planning.echange.valider', { id, motifAlertes: motif.trim() });
    setBusy(false);
    if (r.ok) closeDialog();
  };
  return (
    <Dialog title="Valider l’échange de poste" width={600} onSubmit={envoyer} actions={<>
      <button type="button" className="btn btn-secondary" onClick={() => openDialog({ type: 'confirmer', c: refusEchange(id, `${nom(e.demandeurId)} et ${nom(e.partenaireId)}`) })}>Refuser…</button>
      <SubmitButton busy={busy}>Valider l’échange</SubmitButton>
    </>}>
      <Static>
        {nom(e.demandeurId)} {cb ? `échange son poste du ${ca ? `${jourCourt(ca.jour)} (${posteTexte(ca)})` : '?'} contre celui de ${nom(e.partenaireId)} du ${jourCourt(cb.jour)} (${posteTexte(cb)})`
          : `cède son poste du ${ca ? `${jourCourt(ca.jour)} (${posteTexte(ca)})` : '?'} à ${nom(e.partenaireId)}`} ; accepté par {nom(e.partenaireId)}.
      </Static>
      {a?.refus && <Fine muted={false}>{a.refus}</Fine>}
      {a && a.alertes.refus.length > 0 && <Controles msgs={a.alertes.refus.map(x => ({ text: ligneAlerte(nom, x), bad: true }))} />}
      {a && a.alertes.alertes.length > 0 && <>
        <Controles msgs={a.alertes.alertes.map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />
        <Motif id="val-motif" label="Motif des alertes acceptées" valeur={motif} onChange={setMotif} requis erreur={v.erreur(eMotif)}
          aide="Gardé sur les nouveaux créneaux, vu du planificateur et du service RH seulement ; jamais recopié au journal." placeholder="Repos compensateur accordé…" />
      </>}
      {a && !a.refus && !a.alertes.refus.length && !a.alertes.alertes.length && <Fine muted={false}>Aucune alerte : repos, durées et habilitations respectés pour les deux salariés.</Fine>}
      {/* lot 12 — C5 étape 3 : informations (conflits avec une mission, une session, une astreinte ; moyennes), sans motif,
          plafonnées comme dans Publier pour garder le motif et les boutons à portée sur téléphone. */}
      {a && !a.refus && a.alertes.infos.length > 0 && <Controles msgs={a.alertes.infos.slice(0, 12).map(x => ({ text: ligneAlerte(nom, x), bad: false }))} />}
      {a && !a.refus && a.alertes.infos.length > 12 && <Fine>Et {a.alertes.infos.length - 12} autre{a.alertes.infos.length - 12 > 1 ? 's' : ''} information{a.alertes.infos.length - 12 > 1 ? 's' : ''}.</Fine>}
      {v.tente && bloque && <Bloquant>{bloque}</Bloquant>}
      <Fine>Pas de nouveau délai de prévenance : l’échange vient des intéressés. Chacun est prévenu de la décision.</Fine>
    </Dialog>
  );
}

// — Reprise des équipes par quart —

export function PlanningRepriseDialog() {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const detectees = equipesParQuart(d.ds.referentiels.equipes);
  const cycles = cyclesEnVigueur(d.ds.cycles);
  const [noms, setNoms] = useState<string[]>(detectees[0]?.equipes ?? []);
  const [cycle, setCycle] = useState(cycles.find(c => c.groupes.length >= (detectees[0]?.equipes.length ?? 1))?.code ?? cycles[0]?.code ?? '');
  const [du, setDu] = useState(mondayOf(addD(d.ti, 7)));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const r = DATE.test(du) ? proposerReprise({
    code: cycle, du, noms, equipes: d.ds.referentiels.equipes, cycles: d.ds.cycles ?? [], roulements: d.ds.roulements ?? [], employes: d.ds.employes, exclus: new Set(soi ? [soi] : []),
  }) : null;
  const eDu = !DATE.test(du) ? 'Indiquez le premier jour.' : null;
  const envoyer = async () => {
    if (busy || !v.verifier(eDu, r?.erreur, r && !r.lignes.length ? 'Aucun salarié à affecter.' : null)) return;
    setBusy(true);
    const x = await run('planning.reprise', { cycle, du, equipes: noms });
    setBusy(false);
    if (x.ok) closeDialog();
  };
  const c = cycleDe(d.ds.cycles, cycle);
  return (
    <Dialog title="Reprendre les équipes par quart" width={600} onSubmit={envoyer} actions={<><CancelButton /><SubmitButton busy={busy}>Affecter au cycle</SubmitButton></>}>
      <Fine muted={false}>
        {detectees.length
          ? `Équipes par quart repérées (sous une même équipe, chacune avec son horaire) : ${detectees.map(x => `${x.parente} (${x.equipes.join(', ')})`).join(' ; ')}.`
          : 'Aucune équipe par quart repérée (équipes sœurs ayant chacune un horaire par défaut) : choisissez les équipes à reprendre.'}
      </Fine>
      <Field label="Équipes, dans l’ordre des groupes" requis erreur={v.erreur(r?.erreur && /équipe/i.test(r.erreur) ? r.erreur : null)}>
        <div className="chips" role="group" aria-label="Équipes à reprendre" style={{ gap: 'var(--space-2) var(--space-4)' }}>
          {d.ds.referentiels.equipes.map(q => (
            <label key={q.nom} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={noms.includes(q.nom)} onChange={e => setNoms(e.target.checked ? [...noms, q.nom] : noms.filter(n => n !== q.nom))} style={{ accentColor: 'var(--color-accent)' }} />
              {q.nom}{q.horaire ? <span className="text-muted"> · {q.horaire}</span> : null}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Cycle" htmlFor="rep-cycle" requis erreur={v.erreur(r?.erreur && /cycle/i.test(r.erreur) ? r.erreur : null)}>
          <select className="input" id="rep-cycle" value={cycle} onChange={e => setCycle(e.target.value)}>
            {cycles.map(y => <option key={y.code} value={y.code}>{y.code} · {y.nom} ({plural(y.groupes.length, 'groupe', 'groupes')})</option>)}
          </select>
        </Field>
        <Field label="À partir du" htmlFor="rep-du" requis erreur={v.erreur(eDu)}>
          <input className="input" id="rep-du" type="date" value={du} onChange={e => setDu(e.target.value)} />
        </Field>
      </div>
      {r && !r.erreur && c && (
        <Fine muted={false}>
          {d.ds.referentiels.equipes.filter(q => noms.includes(q.nom)).sort((a, b) => a.ordre - b.ordre).map((q, i) => `${q.nom} → groupe ${c.groupes[i]?.code}`).join(' · ')}.
          {' '}{plural(r.lignes.length, 'salarié à affecter', 'salariés à affecter')}{r.ignores.length ? `, ${plural(r.ignores.length, 'laissé de côté', 'laissés de côté')} (${r.ignores.map(x => `${d.personName(x.empId)} : ${x.raison}`).join(' ; ')})` : ''}.
        </Fine>
      )}
      {v.tente && r && !r.erreur && !r.lignes.length && <Bloquant>Aucun salarié à affecter.</Bloquant>}
      <Fine>
        La première équipe (dans l’ordre des équipes) prend le premier groupe du cycle, la deuxième le deuxième, et ainsi de suite. L’équipe hiérarchique ne change
        pas. Une reprise se rejoue sans doublon : un salarié déjà affecté sur la période est laissé de côté.
      </Fine>
    </Dialog>
  );
}
