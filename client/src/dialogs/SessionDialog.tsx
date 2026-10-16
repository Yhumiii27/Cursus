// Nouvelle session de formation (éventuellement depuis une action du plan), ou modification d'une session ouverte.
// Date postérieure à aujourd'hui (une session passée, à clôturer, se redate au jour où elle a eu lieu), nombre
// entier de places (au moins le nombre d'inscrits) : contrôlés aussi par le serveur.
import { useState } from 'react';
import { PLAN_LABEL } from '../../../shared/constants.ts';
import { addD, parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import { inscritsDe, sessionPassee } from '../../../shared/rules/sessions.ts';
import { erreursSession, type ChampSession } from '../components/controles.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ReferentielVide } from '../components/ReferentielVide.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function SessionDialog({ f: f0, planId, places: places0, sessionId }: { f?: string; planId?: number; places?: number; sessionId?: number }) {
  const { d, emps, forms } = useEnriched();
  const { run, closeDialog, go, openDialog } = useStore();
  const s = sessionId != null ? d.session(sessionId) : null;
  const plan = planId != null ? d.ds.plan.find(l => l.id === planId) : undefined;
  // En modification, la formation est celle de la session ; depuis le plan, celle de l'action.
  const fixe = s?.formation ?? plan?.f ?? null;
  const [f, setF] = useState(fixe ?? (f0 && forms.some(x => x.id === f0) ? f0 : forms[0]?.id ?? ''));
  const [date, setDate] = useState(s?.date ?? '');
  const [places, setPlaces] = useState(String(s?.places ?? places0 ?? 8));
  const [lieu, setLieu] = useState(s?.lieu ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (sessionId != null && !s) return null;
  if (!s && !fixe && !forms.length) return <ReferentielVide titre="Nouvelle session" onglet="formations" texte="Catalogue des formations vide." />;
  const fm = d.fm(f);
  const waiting = emps.flatMap(e => e.certs).filter(c => c.f === f && c.key !== 'ok' && !c.session && !c.sessionPassee).length;
  // Sous chaque champ, tous à la fois : un champ vide à l'envoi ; une saisie incorrecte ou contraire au contrôle
  // partagé avec le serveur (date passée, places en nombre insuffisant) dès la saisie.
  const err = erreursSession(d.ti, { date, lieu, places }, s ? { dateActuelle: s.date, inscrits: s.inscrits } : {});
  const erreur = (k: ChampSession) => err.vides[k] ? v.erreur(err.champs[k]) : err.champs[k];
  const passee = !!s && sessionPassee(d.ti, s.date);
  // Session à venir : convocations à renvoyer, nouvelle date à faire confirmer (comme le serveur).
  const aVenir = !!date && date >= d.ti;
  const moved = !!s && aVenir && (date !== s.date || lieu.trim() !== s.lieu);
  const reconfirmer = !!s && aVenir && date !== s.date && s.statut === 'Confirmée';
  const convoquees = s ? inscritsDe(d, s).filter(i => i.convoc === 'now').length : 0;

  const confirm = async () => {
    if (busy || !v.verifier(err.bloque)) return;
    setBusy(true);
    const r = s
      ? await run('session.modifier', { id: s.id, date, lieu: lieu.trim(), places: Number(places) })
      : await run('session.creer', { f, date, lieu: lieu.trim(), places: Number(places), planId });
    setBusy(false);
    if (!r.ok) return;
    if (s) openDialog({ type: 'sessionDetail', sessionId: s.id });
    else {
      closeDialog();
      if (planId) go('budget');
      else go('formations', { formationFilter: f });
    }
  };

  return (
    <Dialog title={s ? 'Modifier la session' : 'Nouvelle session'} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{s ? 'Enregistrer' : 'Créer la session'}</SubmitButton>
    </>}>
      {fixe
        ? <Field label="Formation"><Static>{fm?.nom ?? fixe}</Static></Field>
        : (
          <Field label="Formation" htmlFor="sess-f">
            <select className="input" id="sess-f" value={f} onChange={e => setF(e.target.value)}>
              {forms.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
            </select>
          </Field>
        )}
      {plan && <Fine>Action du plan {plan.exercice} · {plan.equipe} · {plan.periode} · {PLAN_LABEL[plan.statut].toLowerCase()} : elle passera « engagée ».</Fine>}
      <div className="grid-2">
        <Field label="Date" htmlFor="sess-date" requis erreur={erreur('date')}><input className="input" id="sess-date" type="date" min={passee ? undefined : addD(d.ti, 1)} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Places" htmlFor="sess-places" requis erreur={erreur('places')}>
          <input className="input" id="sess-places" type="number" min={Math.max(1, s?.inscrits ?? 1)} max={60} step={1} value={places} onChange={e => setPlaces(e.target.value)} />
        </Field>
      </div>
      <Field label="Lieu" htmlFor="sess-lieu" requis erreur={erreur('lieu')}><input className="input" id="sess-lieu" type="text" maxLength={200} placeholder="Site de Lyon — salle B" value={lieu} onChange={e => setLieu(e.target.value)} /></Field>
      {s ? (
        <Fine>
          {plural(s.inscrits, 'inscrit', 'inscrits')} · session du {fmt(parse(s.date))}.
          {passee ? ' Session passée : corrigez sa date si elle a eu lieu un autre jour, la clôture date les certifications du jour de la session.' : ''}
          {moved && convoquees > 0 ? ` La nouvelle date ou le nouveau lieu rend caduques ${plural(convoquees, 'convocation envoyée', 'convocations envoyées')} : elles repasseront « à envoyer ».` : ''}
          {reconfirmer ? ` La session repassera « à confirmer » : faites confirmer la nouvelle date par ${fm?.organisme ?? 'l’organisme'}.` : ''}
        </Fine>
      ) : (
        <p className="text-muted fine">
          {fm && (waiting ? `${plural(waiting, 'collaborateur attend', 'collaborateurs attendent')} un renouvellement ${fm.court}.` : `Aucun renouvellement ${fm.court} en attente.`)}
        </p>
      )}
    </Dialog>
  );
}
