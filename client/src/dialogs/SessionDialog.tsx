// Nouvelle session de formation (éventuellement depuis une action du plan), ou modification d'une session ouverte.
// Date postérieure à aujourd'hui (une session passée, à clôturer, se redate au jour où elle a eu lieu), nombre
// entier de places (au moins le nombre d'inscrits) : contrôlés aussi par le serveur. Une session peut durer plusieurs
// jours (t118) : dernier jour, jours de la session (ouvrés par défaut) et horaires facultatifs, communs ou par jour.
// Créée depuis « Planifier » (`retour`, t107) : la formation est celle à planifier, et la création comme l'annulation
// ramènent au dialogue de planification, la nouvelle session présélectionnée (retour-session.ts).
import { useState } from 'react';
import { PLAN_LABEL } from '../../../shared/constants.ts';
import { addD, isValidDate, weekday } from '../../../shared/dates.ts';
import { fH, fmtIsoShort, plural } from '../../../shared/format.ts';
import { dureeHeures } from '../../../shared/rules/formations-temps.ts';
import { finSession, heuresHoraire, joursOuvres, plageTexte, SESSION_ETENDUE_MAX } from '../../../shared/rules/plage-session.ts';
import { inscritsDe, sessionPassee } from '../../../shared/rules/sessions.ts';
import type { HoraireSession, ISODate } from '../../../shared/types.ts';
import { erreursSession, type ChampSession } from '../components/controles.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ReferentielVide } from '../components/ReferentielVide.tsx';
import { Fine } from '../components/ui.tsx';
import { useEnriched } from '../state/derived.ts';
import { useStore, type DialogePlan } from '../state/store.tsx';
import { apresCreation } from './retour-session.ts';

/** Horaires saisis : aucun (journées entières), les mêmes chaque jour, ou un par jour. */
type ModeHoraires = 'aucun' | 'commun' | 'jour';
/** Horaire en cours de saisie (champs du formulaire). */
interface HoraireSaisi { debut: string; fin: string; pause: string }

const HORAIRE_DEFAUT: HoraireSaisi = { debut: '08:30', fin: '16:30', pause: '60' };
const JOUR_COURT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const saisi = (h: HoraireSession): HoraireSaisi => ({ debut: h.debut, fin: h.fin, pause: String(h.pause ?? 0) });
const envoye = (h: HoraireSaisi) => ({ debut: h.debut, fin: h.fin, pause: h.pause.trim() === '' ? 0 : Number(h.pause) });

/** Jours du calendrier du premier au dernier jour (cases à cocher), bornés à l'étendue maximale d'une session. */
function calendrier(du: string, au: string): ISODate[] {
  const out: ISODate[] = [];
  for (let j = du; j <= au && out.length < SESSION_ETENDUE_MAX; j = addD(j, 1)) out.push(j);
  return out;
}

/** Début, fin et pause d'un horaire, sur une ligne. */
function ChampsHoraire({ id, h, onChange, legende }: { id: string; h: HoraireSaisi; onChange: (h: HoraireSaisi) => void; legende?: string }) {
  return (
    <div className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
      {legende && <span className="text-muted sub" style={{ minWidth: 84 }}>{legende}</span>}
      <input className="input" id={`${id}-debut`} type="time" aria-label={`Début${legende ? ` (${legende})` : ''}`} value={h.debut} onChange={e => onChange({ ...h, debut: e.target.value })} style={{ width: 132 }} />
      <span className="text-muted">à</span>
      <input className="input" id={`${id}-fin`} type="time" aria-label={`Fin${legende ? ` (${legende})` : ''}`} value={h.fin} onChange={e => onChange({ ...h, fin: e.target.value })} style={{ width: 132 }} />
      <span className="text-muted">pause</span>
      <input className="input" id={`${id}-pause`} type="number" min={0} max={240} step={5} aria-label={`Pause en minutes${legende ? ` (${legende})` : ''}`} value={h.pause} onChange={e => onChange({ ...h, pause: e.target.value })} style={{ width: 72 }} />
      <span className="text-muted">min</span>
    </div>
  );
}

export function SessionDialog({ f: f0, planId, places: places0, sessionId, retour }: { f?: string; planId?: number; places?: number; sessionId?: number; retour?: DialogePlan }) {
  const { d, emps, forms } = useEnriched();
  const { run, closeDialog, go, openDialog } = useStore();
  const s = sessionId != null ? d.session(sessionId) : null;
  const plan = planId != null ? d.ds.plan.find(l => l.id === planId) : undefined;
  // En modification, la formation est celle de la session ; depuis le plan, celle de l'action ; depuis « Planifier », celle à planifier.
  const fixe = s?.formation ?? plan?.f ?? (retour && f0 ? f0 : null);
  const [f, setF] = useState(fixe ?? (f0 && forms.some(x => x.id === f0) ? f0 : forms[0]?.id ?? ''));
  const [date, setDate] = useState(s?.date ?? '');
  const [fin, setFin] = useState(s && finSession(s) !== s.date ? finSession(s) : '');
  // Jours cochés ; null : les jours ouvrés du premier au dernier (recalculés quand la période change).
  const [jours, setJours] = useState<ISODate[] | null>(() => {
    if (!s) return null;
    const defaut = joursOuvres(s.date, finSession(s));
    return s.jours.join() === defaut.join() ? null : s.jours;
  });
  const [mode, setMode] = useState<ModeHoraires>(!s?.horaires.length ? 'aucun' : s.horaires.length === 1 ? 'commun' : 'jour');
  const [commun, setCommun] = useState<HoraireSaisi>(s?.horaires.length ? saisi(s.horaires[0]) : HORAIRE_DEFAUT);
  const [parJour, setParJour] = useState<Record<ISODate, HoraireSaisi>>(() =>
    Object.fromEntries(s && s.horaires.length > 1 ? s.jours.map((j, i) => [j, saisi(s.horaires[i])]) : []));
  const [places, setPlaces] = useState(String(s?.places ?? places0 ?? 8));
  const [lieu, setLieu] = useState(s?.lieu ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (sessionId != null && !s) return null;
  if (!s && !fixe && !forms.length) return <ReferentielVide titre="Nouvelle session" onglet="formations" texte="Catalogue des formations vide." />;
  const fm = d.fm(f);
  const waiting = emps.flatMap(e => e.certs).filter(c => c.f === f && c.key !== 'ok' && !c.session && !c.sessionPassee).length;

  // Plage : dernier jour vide ou égal au premier, session d'une journée.
  const dernier = isValidDate(date) && isValidDate(fin) && fin > date ? fin : date;
  const plusieurs = isValidDate(date) && dernier !== date;
  const periode = plusieurs ? calendrier(date, dernier) : [];
  const coches = plusieurs ? (jours ?? joursOuvres(date, dernier)).filter(j => j >= date && j <= dernier) : isValidDate(date) ? [date] : [];
  const modeEffectif: ModeHoraires = mode === 'jour' && !plusieurs ? 'commun' : mode;
  const horaires = modeEffectif === 'aucun' ? [] : modeEffectif === 'commun' ? [envoye(commun)] : coches.map(j => envoye(parJour[j] ?? commun));
  const saisie = { date, lieu, places, fin: fin && fin !== date ? fin : '', jours: plusieurs ? coches : [], horaires };

  // Sous chaque champ, tous à la fois : un champ vide à l'envoi ; une saisie incorrecte ou contraire au contrôle
  // partagé avec le serveur (date passée, places en nombre insuffisant, plage) dès la saisie.
  const err = erreursSession(d.ti, saisie, s ? { dateActuelle: s.date, inscrits: s.inscrits } : {});
  const erreur = (k: ChampSession) => err.vides[k] ? v.erreur(err.champs[k]) : err.champs[k];
  const passee = !!s && sessionPassee(d.ti, s.date);
  // Session à venir, ou en cours jusqu'à son dernier jour : convocations à renvoyer ; session à venir : nouvelles dates à
  // faire confirmer (comme le serveur).
  const aVenir = !!date && date >= d.ti, pasFinie = !!dernier && dernier >= d.ti;
  const nouvellePlage = !!s && (date !== s.date || dernier !== finSession(s) || coches.join() !== s.jours.join());
  const nouveauxHoraires = !!s && JSON.stringify(horaires) !== JSON.stringify(s.horaires);
  const moved = !!s && pasFinie && (nouvellePlage || nouveauxHoraires || lieu.trim() !== s.lieu);
  const reconfirmer = !!s && aVenir && nouvellePlage && s.statut === 'Confirmée';
  const convoquees = s ? inscritsDe(d, s).filter(i => i.convoc === 'now').length : 0;
  // Heures prévues (feuilles de temps) : horaires, pause déduite ; sinon la durée du catalogue répartie sur les jours.
  const prevues = !err.champs.horaires && horaires.length ? horaires.length === 1 ? heuresHoraire(horaires[0]) * coches.length : horaires.reduce((n, h) => n + heuresHoraire(h), 0) : null;
  const catalogue = dureeHeures(fm?.duree);

  const cocher = (j: ISODate, oui: boolean) => setJours((jours ?? joursOuvres(date, dernier)).filter(x => x !== j).concat(oui ? [j] : []).sort());

  const confirm = async () => {
    if (busy || !v.verifier(err.bloque)) return;
    setBusy(true);
    const plage = { fin: dernier, jours: coches, horaires };
    const r = s
      ? await run('session.modifier', { id: s.id, date, ...plage, lieu: lieu.trim(), places: Number(places) })
      : await run('session.creer', { f, date, ...plage, lieu: lieu.trim(), places: Number(places), planId });
    setBusy(false);
    if (!r.ok) return;
    if (s) openDialog({ type: 'sessionDetail', sessionId: s.id });
    else if (retour) openDialog(apresCreation(retour, r.result));
    else {
      closeDialog();
      if (planId) go('budget');
      else go('formations', { formationFilter: f });
    }
  };

  return (
    <Dialog title={s ? 'Modifier la session' : 'Nouvelle session'} width={600} onSubmit={confirm} fermer={retour ? () => openDialog(retour) : undefined} actions={<>
      <CancelButton label={retour ? 'Revenir à la planification' : undefined} />
      <SubmitButton busy={busy}>{s ? 'Enregistrer' : 'Créer la session'}</SubmitButton>
    </>}>
      {fixe
        ? <Field label="Formation"><Static>{fm?.nom ?? fixe}{fm?.duree ? <div className="text-muted sub">Durée : {fm.duree}</div> : null}</Static></Field>
        : (
          <Field label="Formation" htmlFor="sess-f">
            <select className="input" id="sess-f" value={f} onChange={e => setF(e.target.value)}>
              {forms.map(o => <option key={o.id} value={o.id}>{o.nom}{o.duree ? ` · ${o.duree}` : ''}</option>)}
            </select>
          </Field>
        )}
      {plan && <Fine>Action du plan {plan.exercice} · {plan.equipe} · {plan.periode} · {PLAN_LABEL[plan.statut].toLowerCase()} : elle passera « engagée ».</Fine>}
      <div className="grid-2">
        <Field label="Premier jour" htmlFor="sess-date" requis erreur={erreur('date')}><input className="input" id="sess-date" type="date" min={passee ? undefined : addD(d.ti, 1)} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Dernier jour" htmlFor="sess-fin" erreur={erreur('fin')}><input className="input" id="sess-fin" type="date" min={date || undefined} value={fin} onChange={e => setFin(e.target.value)} /></Field>
      </div>
      {!plusieurs && <Fine>Dernier jour vide : session d’une journée.</Fine>}
      {plusieurs && (
        <Field label={`Jours de la session (${plural(coches.length, 'jour', 'jours')})`} erreur={erreur('jours')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
            {periode.map(j => (
              <label key={j} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14 }}>
                <input type="checkbox" checked={coches.includes(j)} disabled={j === date || j === dernier} onChange={e => cocher(j, e.target.checked)}
                  style={{ accentColor: 'var(--color-accent)' }} />
                {JOUR_COURT[weekday(j)]} {fmtIsoShort(j)}
              </label>
            ))}
          </div>
        </Field>
      )}
      <Field label="Horaires" htmlFor="sess-horaires" erreur={erreur('horaires')}>
        <select className="input" id="sess-horaires" value={modeEffectif} onChange={e => setMode(e.target.value as ModeHoraires)}>
          <option value="aucun">Sans horaire (journées entières)</option>
          <option value="commun">{plusieurs ? 'Mêmes horaires chaque jour' : 'Horaires de la journée'}</option>
          {plusieurs && <option value="jour">Horaires par jour</option>}
        </select>
      </Field>
      {modeEffectif === 'commun' && <ChampsHoraire id="sess-h" h={commun} onChange={setCommun} />}
      {modeEffectif === 'jour' && (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {coches.map(j => (
            <ChampsHoraire key={j} id={`sess-h-${j}`} legende={`${JOUR_COURT[weekday(j)]} ${fmtIsoShort(j)}`} h={parJour[j] ?? commun}
              onChange={h => setParJour(x => ({ ...x, [j]: h }))} />
          ))}
        </div>
      )}
      {(prevues != null || catalogue != null) && (
        <Fine>
          {prevues != null ? `Heures prévues : ${fH(prevues)}${catalogue != null ? ` (catalogue : ${fH(catalogue)})` : ''}` : `Sans horaire : ${fH(catalogue!)} au catalogue, réparties sur ${plural(coches.length || 1, 'jour', 'jours')}`}
          {' · proposées dans la feuille de temps des inscrits (ligne interne, modifiable).'}
        </Fine>
      )}
      <Field label="Places" htmlFor="sess-places" requis erreur={erreur('places')}>
        <input className="input" id="sess-places" type="number" min={Math.max(1, s?.inscrits ?? 1)} max={60} step={1} value={places} onChange={e => setPlaces(e.target.value)} />
      </Field>
      <Field label="Lieu" htmlFor="sess-lieu" requis erreur={erreur('lieu')}><input className="input" id="sess-lieu" type="text" maxLength={200} placeholder="Site de Lyon — salle B" value={lieu} onChange={e => setLieu(e.target.value)} /></Field>
      {s ? (
        <Fine>
          {plural(s.inscrits, 'inscrit', 'inscrits')} · session {plageTexte(s)}.
          {passee ? ' Session passée : corrigez ses dates si elle a eu lieu d’autres jours, la clôture date les certifications de son dernier jour.' : ''}
          {moved && convoquees > 0 ? ` Les nouvelles dates, les nouveaux horaires ou le nouveau lieu rendent caduques ${plural(convoquees, 'convocation envoyée', 'convocations envoyées')} : elles repasseront « à envoyer ».` : ''}
          {reconfirmer ? ` La session repassera « à confirmer » : faites confirmer les nouvelles dates par ${fm?.organisme ?? 'l’organisme'}.` : ''}
        </Fine>
      ) : (
        <p className="text-muted fine">
          {fm && (waiting ? `${plural(waiting, 'collaborateur attend', 'collaborateurs attendent')} un renouvellement ${fm.court}.` : `Aucun renouvellement ${fm.court} en attente.`)}
        </p>
      )}
    </Dialog>
  );
}
