// Demander une formation (catalogue ou hors catalogue) au service RH :
// le collaborateur pour lui-même, ou le manager pour un membre de son équipe.
import { useMemo, useState } from 'react';
import type { EmpX } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { CancelButton, Dialog, Field, Static } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

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

/** Champ « Pour » : nom du membre désigné, ou choix parmi les membres de l'équipe. */
export function CibleField({ c, id }: { c: ReturnType<typeof useCible>; id: string }) {
  if (c.fixe && c.cible) return <Field label="Pour"><Static>{c.cible.nom} · {c.cible.poste}</Static></Field>;
  return (
    <Field label="Pour" htmlFor={id}>
      <select className="input" id={id} value={c.cible ? String(c.cible.id) : ''} onChange={e => c.setSel(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{c.membres.length ? 'Choisir un collaborateur de votre équipe' : 'Aucun collaborateur dans votre équipe'}</option>
        {c.membres.map(e => <option key={e.id} value={String(e.id)}>{`${e.nom} · ${e.poste}`}</option>)}
      </select>
    </Field>
  );
}

/** Dernière certification détenue pour une formation (toutes formations, filtre réglementaire ignoré). */
const derniere = (e: EmpX, f: string) => e.rawCerts.filter(x => x.f === f).sort((a, b) => b.exp.getTime() - a.exp.getTime())[0];

/**
 * Motif proposé : recyclage seulement si la formation a déjà été suivie ; sinon prérequis
 * d'une habilitation détenue ou demandée, ou formation initiale. Vide si le collaborateur n'est pas connu.
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
  const demandee = f0 && f0 !== 'autre' ? d.ds.referentiels.formations.find(x => x.id === f0) : undefined;
  const options = demandee && !forms.some(x => x.id === demandee.id) ? [...forms, demandee] : forms;
  const [f, setF] = useState(demandee?.id ?? forms[0]?.id ?? 'autre');
  const [libelle, setLibelle] = useState('');
  const [session, setSession] = useState(s0 != null ? String(s0) : '');
  const [motif, setMotif] = useState(() => motifPropose(c.pourMembre ? c.cible : emps.find(x => x.id === me), demandee?.id));
  const [busy, setBusy] = useState(false);
  const isAutre = f === 'autre';
  const sessions = isAutre ? [] : d.upcoming().filter(s => s.formation === f && s.inscrits < s.places);

  // Manager : contrôle de l'existant pour le collaborateur concerné.
  const e = c.cible;
  const last = e && !isAutre ? derniere(e, f) : undefined;
  // Session à venir : recyclage rattaché à la certification, ou inscription en formation initiale.
  const initiale = e && !isAutre
    ? d.ds.inscriptions.map(i => i.empId === e.id ? d.session(i.sessionId) : null).find(s => !!s && s.formation === f && s.date >= d.ti) ?? null
    : null;
  const inscrit = (last?.session && last.session.date >= d.ti ? last.session : null) ?? initiale;
  const enCours = !!e && !isAutre && d.ds.demandesCollab.some(r => r.empId === e.id && r.type === 'formation' && r.f === f && r.statut === 'attente');
  const bloque = c.pourMembre && (!e || enCours || !!inscrit);
  const existant = !e || isAutre ? null
    : enCours ? `Une demande pour cette formation est déjà en cours pour ${e.nom}.`
    : inscrit ? `${e.nom} est déjà inscrit à la session du ${fmt(parse(inscrit.date))}.`
    : !last ? `${e.nom} n’a pas encore suivi cette formation.`
    : last.key === 'ok' ? `${e.nom} détient cette certification, valide jusqu’au ${fmt(last.exp)}.`
    : last.key === 'due' ? `Certification de ${e.nom} à renouveler : elle expire le ${fmt(last.exp)}.`
    : `Certification de ${e.nom} expirée le ${fmt(last.exp)}.`;
  // Inscription directe (dialogue de planification) : formations du catalogue affiché uniquement.
  const directe = !!e && !!last && last.key !== 'ok' && !inscrit && sessions.length > 0 && forms.some(x => x.id === f);
  const cant = !motif.trim() || (isAutre && !libelle.trim()) || bloque;

  const confirm = async () => {
    setBusy(true);
    const r = await run('demande.formation', {
      f, libelle: libelle.trim(), sessionId: session ? Number(session) : null, motif: motif.trim(), ...(c.pourMembre && e ? { empId: e.id } : {}),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Demander une formation" width={540} actions={<>
      <CancelButton />
      {directe && <button type="button" className="btn btn-ghost" onClick={() => openDialog({ type: 'plan', empId: e!.id, certId: last!.id })}>Inscrire directement</button>}
      <button type="button" className="btn btn-primary" disabled={cant || busy} onClick={confirm}>Envoyer la demande</button>
    </>}>
      {c.pourMembre && <CibleField c={c} id="rf-emp" />}
      <Field label="Formation" htmlFor="rf-f">
        <select className="input" id="rf-f" value={f} onChange={ev => { setF(ev.target.value); setSession(''); }}>
          {options.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          <option value="autre">Autre — hors catalogue</option>
        </select>
      </Field>
      {existant && (enCours || inscrit ? <p className="fine note-accent">{existant}</p> : <Fine>{existant}</Fine>)}
      {isAutre && (
        <Field label="Intitulé souhaité" htmlFor="rf-lib">
          <input className="input" id="rf-lib" type="text" placeholder="Anglais technique, management…" value={libelle} onChange={ev => setLibelle(ev.target.value)} />
        </Field>
      )}
      {sessions.length > 0 && (
        <Field label="Session souhaitée" htmlFor="rf-s">
          <select className="input" id="rf-s" value={session} onChange={ev => setSession(ev.target.value)}>
            <option value="">Pas de préférence</option>
            {sessions.map(s => (
              <option key={s.id} value={String(s.id)}>{`${fmt(parse(s.date))} · ${s.lieu} · ${plural(s.places - s.inscrits, 'place', 'places')}`}</option>
            ))}
          </select>
        </Field>
      )}
      {!isAutre && sessions.length === 0 && <Fine>Aucune session ouverte : la demande sera ajoutée au plan de formation.</Fine>}
      <Field label="Motif" htmlFor="rf-m">
        <textarea className="input mid" id="rf-m" rows={3} placeholder={c.pourMembre ? 'Besoin identifié, échéance, chantier à venir…' : 'Pourquoi cette formation ?'}
          value={motif} onChange={ev => setMotif(ev.target.value)} />
      </Field>
      <Fine>{c.pourMembre
        ? `Demande transmise au service RH${e ? ` pour ${e.nom}` : ''}, qui l’inscrit à une session ou l’ajoute au plan de formation.`
        : 'Votre demande est transmise au service RH, qui vous répond ici.'}</Fine>
    </Dialog>
  );
}
