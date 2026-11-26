// Liste d'attente des sessions complètes (lot 7, chantier C, t120 ; règles : shared/rules/liste-attente.ts) :
// - `ListeAttenteSession` : la file d'une session, dans son détail (service RH, référent HSE, lecture seule) ; une place
//   libérée y est « proposée » par Cursus : le service RH confirme l'inscription (la convocation part à ce moment-là) ou
//   retire la personne de la file ;
// - `ListeAttentePortail` : la place du salarié dans les files où il attend (Mon espace), et son retrait ;
// - `ListeAttenteFiche` : celles d'un collaborateur sur sa fiche (service RH, manager), et leur retrait.
// Le jeu de données est déjà restreint au profil (server/src/dataset.ts) : le salarié ne voit que sa place, jamais les autres.
import { parse } from '../../../shared/dates.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { equipeLabel, fmt, fmtShort } from '../../../shared/format.ts';
import { attenteActive, fileDe, placeTexte, placesAProposer } from '../../../shared/rules/liste-attente.ts';
import { sessionDu } from '../../../shared/rules/plage-session.ts';
import type { AttenteSession, Employe, Session } from '../../../shared/types.ts';
import { useAgir } from '../state/actions.ts';
import { retraitAttente } from '../state/confirmations-attente.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Fine, NoteAccent, Panel, SectionLabel, Tag, Two } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

/** État d'une attente en file : proposée au service RH (place libérée), ou en attente avec sa place. */
const etat = (a: AttenteSession) => (a.statut === 'proposee'
  ? <Tag cls="tag-accent" style={{ flex: 'none' }}>{t('Place offered')}</Tag>
  : <Tag cls="tag-outline" style={{ flex: 'none' }}>{a.position ? `${a.position}${t(a.position === 1 ? 'st in the queue' : 'th in the queue')}` : t('In the queue')}</Tag>);

/** File d'attente d'une session ouverte, dans le détail de la session. */
export function ListeAttenteSession({ s }: { s: Session }) {
  const d = useDomain();
  const { formations } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const file = fileDe(d.ds.attentesSession ?? [], s.id);
  if (!file.length) return null;
  const quoi = `${d.fm(s.formation)?.court ?? s.formation} ${sessionDu(s)}`;
  const libres = Math.max(0, s.places - s.inscrits);
  // Place libre qui n'est proposée à personne : le service RH peut confirmer une personne de la file, hors de son tour.
  const horsTour = placesAProposer(s, d.ds.attentesSession ?? []) > 0;
  const aVenir = sessionActive(s) && s.date >= d.ti;
  return <>
    <SectionLabel>{t('Waiting list')} ({file.length})</SectionLabel>
    <div className="scroll-x">
      <table className="table">
        <thead><tr><th>{t('Rank')}</th><th>{t('Employee')}</th><th>{t('Path')}</th><th>{t('State')}</th>{formations && aVenir && <th></th>}</tr></thead>
        <tbody>
          {file.map(a => {
            const e = d.emp(a.empId);
            const nom = e?.nom ?? d.personName(a.empId);
            const confirmable = libres > 0 && (a.statut === 'proposee' || horsTour);
            return (
              <tr key={a.id}>
                <td className="nowrap">{a.position ?? '—'}</td>
                <td><Two main={nom} sub={`${equipeLabel(e)}${t(' · in the queue since ')}${fmtShort(parse(a.le))}`} /></td>
                <td>{t(a.certId ? 'Refresher' : 'Initial training')}</td>
                <td>
                  {etat(a)}
                  {a.statut === 'proposee' && a.proposeeLe && <div className="text-muted sub nowrap">{t('on#le')} {fmtShort(parse(a.proposeeLe))}{libres ? '' : t(' · no free place left')}</div>}
                </td>
                {formations && aVenir && (
                  <td className="right">
                    <div className="actions-end">
                      {confirmable && <Btn small variant="secondary" disabled={occupe} onClick={agir(() => run('attente.confirmer', { id: a.id }))}>{t('Confirm the enrolment')}</Btn>}
                      <Btn small disabled={occupe} onClick={() => openDialog({ type: 'confirmer', c: retraitAttente(a, nom, quoi, { soi: false, proposee: a.statut === 'proposee', retour: { type: 'sessionDetail', sessionId: s.id } }) })}>{t('Remove')}</Btn>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <Fine>
      {t('Order in which HR accepts the requests, with no other priority. When a place frees up, Cursus offers HR the first person still eligible (contract, absences and other sessions on those days, certification still to renew); ')}{t(d.ds.settings.formationsAttenteMode === 'automatique'
        ? 'setting “automatic enrolment”: they are enrolled and sent the notice at once.'
        : 'the enrolment is confirmed here, and the notice goes at that moment.')}
      {' '}{t('The list is closed if the session is cancelled or closed: the requests go back to the training plan.')}
    </Fine>
  </>;
}

/** Ligne d'une attente du salarié (portail) ou d'un collaborateur (fiche) : session, place, retrait. */
function LigneAttente({ a, soi, peutRetirer }: { a: AttenteSession; soi: boolean; peutRetirer: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const s = d.session(a.sessionId);
  if (!s) return null;
  const fm = d.fm(s.formation);
  const nom = d.personName(a.empId);
  return (
    <div className="list-row stack" style={{ padding: 'var(--space-3) 0', gap: 'var(--space-1)' }}>
      <div className="item-head">
        <div>
          <div style={{ fontSize: 14 }}>{fm?.nom ?? s.formation}</div>
          <div className="text-muted sub">{t('Session ')}{sessionDu(s)} · {s.lieu}{t(' · full#fem')}</div>
        </div>
        {etat(a)}
      </div>
      <div className="sub text-n400">
        {a.statut === 'proposee'
          ? t('A place has freed up: HR confirms the enrolment, the notice will follow')
          : `${placeTexte(a.position)}${t(' since #le')}${fmt(parse(a.le))}${t(soi ? ': you will be enrolled if a place frees up' : ': enrolment if a place frees up')}`}
      </div>
      {peutRetirer && (
        <div className="actions-end">
          <Btn small onClick={() => openDialog({ type: 'confirmer', c: retraitAttente(a, nom, `${fm?.court ?? s.formation} ${sessionDu(s)}`, { soi, proposee: a.statut === 'proposee' }) })}>
            {t(soi ? 'Remove me from the list' : 'Remove from the list')}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** Mon espace : les listes d'attente où le salarié connecté attend, avec sa place. */
export function ListeAttentePortail({ empId }: { empId: number }) {
  const d = useDomain();
  const mes = (d.ds.attentesSession ?? []).filter(a => a.empId === empId && attenteActive(a));
  if (!mes.length) return null;
  return (
    <Panel title={t('My waiting lists')} aside={tn(mes.length, 'full session', 'full sessions')} style={{ gap: 'var(--space-2)' }}>
      {mes.map(a => <LigneAttente key={a.id} a={a} soi peutRetirer />)}
      <Fine>{t('The queue follows the order in which HR accepted the requests. Once removed from the list, you do not get your place back.')}</Fine>
    </Panel>
  );
}

/** Fiche collaborateur : ses listes d'attente (service RH, référent HSE, manager direct pour le retrait). */
export function ListeAttenteFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { formations, manager } = useRole();
  const siennes = (d.ds.attentesSession ?? []).filter(a => a.empId === e.id && attenteActive(a));
  if (!siennes.length) return null;
  // Retrait : service RH et référent HSE, ou le manager direct (jamais la lecture seule ni un N+2 en consultation).
  const peutRetirer = formations || (manager && d.mgrOf(e) === d.ds.user?.empId && !(d.ds.lectureSeule ?? []).includes(e.id));
  return <>
    <SectionLabel>{t('Waiting lists')}</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {siennes.map(a => <LigneAttente key={a.id} a={a} soi={false} peutRetirer={peutRetirer} />)}
    </div>
    {siennes.some(a => a.statut === 'proposee') && formations && (
      <NoteAccent>{t('Place freed: confirm the enrolment from the detail of the session (Training).')}</NoteAccent>
    )}
  </>;
}

/** Résumé de la file d'une session dans les listes (écran Formations) : nombre en attente, place proposée à confirmer. */
export function ResumeAttente({ s }: { s: Pick<Session, 'id'> }) {
  const d = useDomain();
  const file = fileDe(d.ds.attentesSession ?? [], s.id);
  if (!file.length) return null;
  const proposees = file.filter(a => a.statut === 'proposee').length;
  return <div className="text-muted sub nowrap">{file.length}{t(' on the waiting list')}{proposees ? ` · ${tn(proposees, 'place to confirm', 'places to confirm')}` : ''}</div>;
}
