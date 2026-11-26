// Demander une formation (catalogue ou hors catalogue) au service RH :
// le collaborateur pour lui-même, ou le manager pour un membre de son équipe.
// Doublons (demande identique en attente, inscription à venir) et conflits de dates de la session souhaitée contrôlés en direct.
import { useMemo, useState } from 'react';
import { certEnVigueur, sessionActive, type EmpX } from '../../../shared/domain.ts';
import { fmt, key } from '../../../shared/format.ts';
import { blocage, conflitsSession } from '../../../shared/rules/conflits.ts';
import { plageCourte, sessionDu } from '../../../shared/rules/plage-session.ts';
import { Bloquant, CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreurTexte } from '../components/controles.ts';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/**
 * Collaborateur concerné par une demande faite par un manager : le membre désigné (`empId`)
 * ou, à défaut, celui choisi dans la liste des membres de ses équipes.
 */
export function useCible(empId: number | null | undefined) {
  const { d, emps } = useEnriched();
  const { manager, me } = useRole();
  const membres = useMemo(
    () => manager ? emps.filter(e => e.id !== me && d.mgrOf(e) === me).sort((a, b) => a.nom.localeCompare(b.nom)) : [],
    [d, emps, manager, me],
  );
  const fixe = empId != null && membres.some(e => e.id === empId);
  const [sel, setSel] = useState<number | null>(fixe ? empId ?? null : null);
  const cible: EmpX | undefined = membres.find(e => e.id === sel);
  return { pourMembre: manager, membres, fixe, cible, setSel };
}

/** Champ « Pour » : nom du membre désigné, ou choix parmi les membres de l'équipe (obligatoire). */
export function CibleField({ c, id, erreur }: { c: ReturnType<typeof useCible>; id: string; erreur?: string | null }) {
  if (c.fixe && c.cible) return <Field label={t('For')}><Static>{c.cible.nom} · {c.cible.poste}</Static></Field>;
  return (
    <Field label={t('For')} htmlFor={id} requis erreur={erreur}>
      <ChoixCollaborateur id={id} emps={c.membres} valeur={c.cible?.id ?? null} onChange={c.setSel} requis erreur={erreur}
        placeholder={t(c.membres.length ? 'Choose an employee of your team' : 'No employee in your team')} />
    </Field>
  );
}

/** Certification en vigueur pour une formation (toutes formations, filtre réglementaire ignoré). */
const derniere = (e: EmpX, f: string) => certEnVigueur(e.rawCerts, f);

/**
 * Motif proposé : recyclage seulement si la formation a déjà été suivie ; sinon prérequis
 * d'une habilitation détenue ou demandée, ou formation initiale. Vide si le collaborateur n'est pas connu.
 * Texte saisi prérempli, enregistré tel quel : il reste en français quelle que soit la langue de l'interface (CU-N01).
 */
function motifPropose(e: EmpX | undefined, f: string | undefined): string {
  if (!e || !f || f === 'autre') return '';
  const last = derniere(e, f);
  if (last) return last.key === 'exp' ? 'Recyclage — certification expirée' : 'Recyclage avant expiration';
  const hab = e.habs.find(h => h.hm.prereqs.includes(f));
  return hab ? `Prérequis d’une habilitation — ${hab.hm.nom}` : 'Formation initiale';
}

export function ReqFormDialog({ f: f0, sessionId: s0, empId }: { f?: string; sessionId?: number | null; empId?: number | null }) {
  const { d, emps, forms } = useEnriched();
  const { me } = useRole();
  const { run, closeDialog, openDialog } = useStore();
  const c = useCible(empId);
  // La formation demandée reste proposée même si le catalogue est filtré (« réglementaires uniquement »).
  const demandee = f0 && f0 !== 'autre' ? d.ds.referentiels.formations.find(x => x.id === f0 && !x.archive) : undefined;
  const options = demandee && !forms.some(x => x.id === demandee.id) ? [...forms, demandee] : forms;
  const [f, setF] = useState(demandee?.id ?? forms[0]?.id ?? 'autre');
  const [libelle, setLibelle] = useState('');
  const [session, setSession] = useState(s0 != null ? String(s0) : '');
  const [motif, setMotif] = useState(() => motifPropose(c.pourMembre ? c.cible : emps.find(x => x.id === me), demandee?.id));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const isAutre = f === 'autre';
  // Sessions complètes proposées aussi quand la liste d'attente est activée (lot 7, t120) : le service RH y placera le salarié.
  const attente = d.ds.settings.formationsListeAttente;
  const sessions = isAutre ? [] : d.upcoming().filter(s => s.formation === f && (attente || s.inscrits < s.places));
  const ouvertes = sessions.filter(s => s.inscrits < s.places);

  // Collaborateur concerné : le membre choisi par le manager, ou le collaborateur lui-même (`soi`).
  const e = c.cible;
  const soi = c.pourMembre ? undefined : emps.find(x => x.id === me);
  const sujet = e ?? soi;
  const last = sujet && !isAutre ? derniere(sujet, f) : undefined;
  // Session à venir : recyclage rattaché à la certification, ou inscription en formation initiale.
  const initiale = sujet && !isAutre
    ? d.ds.inscriptions.map(i => i.empId === sujet.id ? d.session(i.sessionId) : null).find(s => !!s && s.formation === f && sessionActive(s) && s.date >= d.ti) ?? null
    : null;
  const inscrit = (last?.session && last.session.date >= d.ti ? last.session : null) ?? initiale;
  // Demande identique en attente (hors catalogue : même intitulé) : refusée par le serveur.
  const enCours = !!sujet && d.ds.demandesCollab.some(r => r.empId === sujet.id && r.type === 'formation' && r.statut === 'attente'
    && (isAutre ? !r.f && !!libelle.trim() && key(r.libelle) === key(libelle) : r.f === f));
  const choisie = session ? d.session(Number(session)) : null;
  const conflits = sujet && choisie ? conflitsSession(d, sujet.id, choisie) : [];
  const bloque = (c.pourMembre && !e) || enCours || !!inscrit || !!blocage(conflits);
  const existant = soi
    ? (enCours ? t('A request for this training course is already in progress.') : inscrit ? `${t('You are already enrolled in the session ')}${sessionDu(inscrit)}.` : null)
    : !e ? null
    : enCours ? `${t('A request for this training course is already in progress for ')}${e.nom}.`
    : isAutre ? null
    : inscrit ? `${e.nom}${t(' is already enrolled in the session ')}${sessionDu(inscrit)}.`
    : !last ? `${e.nom}${t(' has not yet followed this training course.')}`
    : last.key === 'ok' ? `${e.nom}${t(' holds this certification, valid until ')}${fmt(last.exp)}.`
    : last.key === 'due' ? `${t('Certification of ')}${e.nom}${t(' to renew: it expires on ')}${fmt(last.exp)}.`
    : `${t('Certification of ')}${e.nom}${t(' expired on ')}${fmt(last.exp)}.`;
  // Inscription directe (dialogue de planification) : formations du catalogue affiché uniquement.
  const directe = !!e && !!last && last.key !== 'ok' && !inscrit && ouvertes.length > 0 && forms.some(x => x.id === f);
  const erreurs = {
    cible: c.pourMembre && !e ? t('Choose the employee concerned.') : null,
    libelle: isAutre ? erreurTexte(libelle, t('Enter the title of the training course wanted.')) : null,
    motif: erreurTexte(motif, t('Enter the reason for the request.')),
  };

  const confirm = async () => {
    if (busy || !v.verifier(...Object.values(erreurs), bloque)) return;
    setBusy(true);
    const r = await run('demande.formation', {
      f, libelle: libelle.trim(), sessionId: session ? Number(session) : null, motif: motif.trim(), ...(c.pourMembre && e ? { empId: e.id } : {}),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Request a training course')} width={540} onSubmit={confirm} actions={<>
      <CancelButton />
      {directe && <button type="button" className="btn btn-ghost" onClick={() => openDialog({ type: 'plan', empId: e!.id, certId: last!.id })}>{t('Enrol directly')}</button>}
      <SubmitButton busy={busy}>{t('Send the request')}</SubmitButton>
    </>}>
      {c.pourMembre && <CibleField c={c} id="rf-emp" erreur={v.erreur(erreurs.cible)} />}
      <Field label={t('Training course')} htmlFor="rf-f">
        <select className="input" id="rf-f" value={f} onChange={ev => { setF(ev.target.value); setSession(''); }}>
          {options.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          <option value="autre">{t('Other — outside the catalogue')}</option>
        </select>
      </Field>
      {existant && (enCours || inscrit ? <Bloquant>{existant}</Bloquant> : <Fine>{existant}</Fine>)}
      {isAutre && (
        <Field label={t('Title wanted')} htmlFor="rf-lib" requis erreur={v.erreur(erreurs.libelle)}>
          <input className="input" id="rf-lib" type="text" placeholder={t('Technical English, management…')} value={libelle} onChange={ev => setLibelle(ev.target.value)} />
        </Field>
      )}
      {sessions.length > 0 && (
        <Field label={t('Session wanted')} htmlFor="rf-s">
          <select className="input" id="rf-s" value={session} onChange={ev => setSession(ev.target.value)}>
            <option value="">{t('No preference')}</option>
            {sessions.map(s => (
              <option key={s.id} value={String(s.id)}>{`${plageCourte(s)} · ${s.lieu} · ${s.inscrits < s.places ? tn(s.places - s.inscrits, 'place', 'places') : t('full, waiting list')}`}</option>
            ))}
          </select>
        </Field>
      )}
      {choisie && choisie.inscrits >= choisie.places && <Fine>{t(soi ? 'Session full: HR may put your request on the waiting list, in the order in which it accepts the requests; a place freed is offered to the first in the queue.' : 'Session full: HR may put the request on the waiting list, in the order in which it accepts the requests; a place freed is offered to the first in the queue.')}</Fine>}
      <Controles msgs={conflits} />
      {!isAutre && sessions.length === 0 && <Fine>{t('No open session: the request will be added to the training plan.')}</Fine>}
      <Field label={t('Reason')} htmlFor="rf-m" requis erreur={v.erreur(erreurs.motif)}>
        <textarea className="input mid" id="rf-m" rows={3} placeholder={t(c.pourMembre ? 'Need identified, due date, upcoming worksite…' : 'Why this training course?')}
          value={motif} onChange={ev => setMotif(ev.target.value)} />
      </Field>
      <Fine>{c.pourMembre
        ? `${t('Request sent to HR')}${e ? `${t(' for ')}${e.nom}` : ''}${t(', who enrols them in a session or adds them to the training plan.')}`
        : t('Your request is sent to HR, who answers you here.')}</Fine>
    </Dialog>
  );
}
