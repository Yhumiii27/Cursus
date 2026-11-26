// lot 11 — notes de frais (étape 2) : listes de notes, détail d'une note (dépenses, justificatifs, alertes, actions du
// circuit selon la personne connectée), avances et véhicules. Écran pages/Frais.tsx ; une colonne sur le téléphone.
// Les boutons reprennent les droits du serveur (components/frais/commun.ts) ; une transition envoie la note affichée.
import { CheckIcon, PaperclipIcon, PlusIcon } from '@phosphor-icons/react';
import { fmtIso } from '../../../../shared/format.ts';
import { CATEGORIES_FRAIS, STATUTS_NOTE_FRAIS } from '../../../../shared/rules/frais.ts';
import { TYPES_VEHICULE } from '../../../../shared/rules/frais-km.ts';
import type { AvanceFrais, NoteFrais } from '../../../../shared/types.ts';
import { lienPiece } from '../../api.ts';
import { useAgir } from '../../state/actions.ts';
import { annulationNote, refusAvance, refusDepense, renvoiNote, suppressionDepense } from '../../state/confirmations-frais.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Ouvrir } from '../Cliquable.tsx';
import { Btn, Empty, Fine, Kpi, Kpis, Panel, Tag, Two } from '../ui.tsx';
// lot 12 — C2 (notes de frais : activation)
import { DetailHistorique } from './Historique.tsx';
import { t, tn } from '../../i18n/langue.ts';
import { clsAlerte, decideAvance, droitsNote, euros, justificatifs, nomNote, rattachement, STATUTS_AVANCE, syntheseNote } from './commun.ts';

/** Liste de notes : une ligne par note (salarié si `avecNom`, mois, statut, dépenses, total) ; un clic ouvre le détail. */
export function ListeNotes({ notes, avecNom, vide }: { notes: readonly NoteFrais[]; avecNom?: boolean; vide: string }) {
  const d = useDomain();
  const { ui, setUi } = useStore();
  if (!notes.length) return <Empty>{vide}</Empty>;
  return (
    <div>
      {notes.map(n => {
        const s = syntheseNote(d, n), sel = ui.fraisNote === n.id, st = STATUTS_NOTE_FRAIS[n.statut];
        const ouvrir = () => setUi({ fraisNote: sel ? null : n.id });
        return (
          <div key={n.id} className="list-row top clickable" onClick={ouvrir} style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <Ouvrir pressed={sel} onOpen={ouvrir}>{avecNom ? `${d.personName(n.empId)} — ` : ''}{nomNote(n)}</Ouvrir>
              <div className="text-muted sub">{rattachement(d, n) || t('No link')} · {tn(s.nb, 'expense', 'expenses')}{s.refusees ? ` · ${tn(s.refusees, 'refused#depense', 'refused#depenses')}` : ''}{s.detail ? '' : t(' · details on demand')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {s.bloquantes > 0 && <Tag cls="tag-accent">{tn(s.bloquantes, 'blocking point', 'blocking points')}</Tag>}
              <Tag cls={st.cls}>{st.label}</Tag>
              <span className="tnum" style={{ minWidth: 90, textAlign: 'right' }}>{euros(s.retenu)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Détail d'une note : dépenses, justificatifs et alertes, circuit, actions permises. */
export function DetailNote({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useDomain();
  const { user } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  const n = (d.ds.notesFrais ?? []).find(x => x.id === id);
  if (!n) return null;
  const s = syntheseNote(d, n), dr = droitsNote(d, user, n), nom = d.personName(n.empId);
  // lot 12 — C2 : note payée depuis plus de 2 mois, sans ses dépenses dans l'instantané : détail chargé à la demande, en
  // lecture (plus aucune action sur une note payée).
  if (!s.detail) return <DetailHistorique id={n.id} onClose={onClose} />;
  const soi = n.empId === user.empId;
  const st = STATUTS_NOTE_FRAIS[n.statut];
  const circuit = [
    n.soumiseLe && `${t('submitted on #fem')}${fmtIso(n.soumiseLe.slice(0, 10))}`,
    n.valideeLe && `${t('approved on #fem')}${fmtIso(n.valideeLe.slice(0, 10))}${n.valideePar ? `${t(' by ')}${n.valideePar}` : ''}`,
    n.controleeLe && `${t('checked on #fem')}${fmtIso(n.controleeLe.slice(0, 10))}${n.controleePar ? `${t(' by ')}${n.controleePar}` : ''}`,
    n.payeeLe && `${t('paid on #fem')}${fmtIso(n.payeeLe.slice(0, 10))}`,
    n.annuleeLe && `${t('cancelled on #fem')}${fmtIso(n.annuleeLe.slice(0, 10))}`,
  ].filter(Boolean).join(' · ');
  return (
    <Panel highlight title={`${soi ? '' : `${nom} — `}${nomNote(n)}`} aside={<Btn small onClick={onClose}>{t('Close')}</Btn>}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag cls={st.cls}>{st.label}</Tag>
        <span className="text-muted sub">{rattachement(d, n) || t('No link')}{circuit ? ` · ${circuit}` : ''}</span>
      </div>
      {n.statut === 'a_corriger' && n.renvoiMotif && <div className="note-accent" role="note">{t('Sent back for correction')}{n.renvoyeePar ? `${t(' by ')}${n.renvoyeePar}` : ''}{t(': ')}{n.renvoiMotif}</div>}
      <Kpis>
        <Kpi kicker={t('Requested#masc')} value={<span className="tnum">{euros(s.demande)}</span>} />
        <Kpi kicker={t('Reimbursed')} value={<span className="tnum">{euros(s.retenu)}</span>} sub={s.refusees ? tn(s.refusees, 'refused expense', 'refused expenses') : undefined} />
        {s.reintegrable > 0 && <Kpi kicker={t('Reinstatable (payroll)')} value={<span className="tnum">{euros(s.reintegrable)}</span>} sub={t('allowances beyond the limits')} />}
        {!n.medicale && s.tva > 0 && <Kpi kicker={t('Recoverable VAT')} value={<span className="tnum">{euros(s.tva)}</span>} />}
      </Kpis>
      {s.lignes.length === 0 ? <Empty>{t('No expense in this note.')}</Empty> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {s.lignes.map(l => {
            const alertes = s.alertes.get(l.id) ?? [], pj = justificatifs(d.ds.pieces, l);
            return (
              <li key={l.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', opacity: l.refuseeLe ? 0.7 : 1 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <Two main={`${CATEGORIES_FRAIS[l.categorie].label} · ${fmtIso(l.date)}`}
                    sub={[l.commercant, l.km ? `${String(l.km).replace('.', ',')} km${l.depart || l.arrivee ? ` (${[l.depart, l.arrivee].filter(Boolean).join(' → ')})` : ''}` : null, l.invites ? `${t('Guests: ')}${l.invites}` : null].filter(Boolean).join(' · ') || undefined} />
                  <span style={{ flex: 1 }} />
                  <span className="tnum">
                    {l.devise !== 'EUR' ? `${euros(l.montant, l.devise)} = ` : ''}{euros(l.montantEur)}
                    {l.montantRetenu != null && !l.refuseeLe ? ` → ${euros(l.montantRetenu)}${t(' retained#plural')}` : ''}
                  </span>
                </div>
                {l.refuseeLe && <div className="note-accent">{t('Expense refused at the check')}{l.refusMotif ? `${t(': ')}${l.refusMotif}` : ''}</div>}
                {alertes.length > 0 && (
                  <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                    {alertes.map((a, i) => <Tag key={i} cls={clsAlerte(a)}>{a.texte}</Tag>)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }} className="sub">
                  {pj.map(p => (
                    <a key={p.id} href={lienPiece(p.id)} target="_blank" rel="noopener noreferrer"><PaperclipIcon size={14} aria-hidden="true" /> {p.nom}</a>
                  ))}
                  {!pj.length && l.sansJustificatif && !alertes.some(a => a.code === 'attestation') && <span className="text-muted">{t('Without supporting document (sworn statement)')}</span>}
                  <span style={{ flex: 1 }} />
                  {dr.saisir && <Btn small onClick={() => openDialog({ type: 'fraisDepense', id: l.id })}>{t('Edit')}</Btn>}
                  {dr.saisir && <Btn small onClick={() => openDialog({ type: 'confirmer', c: suppressionDepense(l) })}>{t('Remove')}</Btn>}
                  {dr.controler && !l.refuseeLe && <Btn small onClick={() => openDialog({ type: 'fraisPlafond', id: l.id })}>{t('Amount retained')}</Btn>}
                  {dr.controler && !l.refuseeLe && <Btn small onClick={() => openDialog({ type: 'confirmer', c: refusDepense(l, nom) })}>{t('Refuse')}</Btn>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {dr.saisir && <Btn small icon={<PlusIcon size={14} />} onClick={() => openDialog({ type: 'fraisDepense', noteId: n.id })}>{t('Add an expense')}</Btn>}
        {dr.soumettre && s.lignes.length > 0 && <Btn small variant="primary" disabled={occupe} onClick={agir(() => run('frais.note.soumettre', { id: n.id }))}>{t('Submit the note')}</Btn>}
        {dr.valider && <Btn small variant="primary" icon={<CheckIcon size={14} />} disabled={occupe} onClick={agir(() => run('frais.note.valider', { id: n.id }))}>{t('Approve')}</Btn>}
        {dr.controler && <Btn small variant="primary" icon={<CheckIcon size={14} />} disabled={occupe} onClick={agir(() => run('frais.note.controler', { id: n.id }))}>{t('Check the note')}</Btn>}
        {dr.renvoyer && <Btn small onClick={() => openDialog({ type: 'confirmer', c: renvoiNote(n, nom, n.statut !== 'soumise') })}>{t('Send back for correction')}</Btn>}
        {dr.annuler && <Btn small onClick={() => openDialog({ type: 'confirmer', c: annulationNote(n, soi ? null : nom) })}>{t('Cancel the note')}</Btn>}
      </div>
      {s.bloquantes > 0 && (dr.soumettre || dr.controler) && <Fine muted={false}>{t('The blocking points prevent the ')}{dr.controler ? t('approval at the check') : t('submission')}{t(': correct the expense, attach the receipt or make a sworn statement.')}</Fine>}
      {n.medicale && <Fine>{t('Medical expenses: note checked without going through the manager; neither amount nor nature is shown to them.')}</Fine>}
    </Panel>
  );
}

/** Avances : liste, avec validation ou refus pour qui en décide. */
export function ListeAvances({ avances, avecNom }: { avances: readonly AvanceFrais[]; avecNom?: boolean }) {
  const d = useDomain();
  const { user } = useRole();
  const { run, openDialog } = useStore();
  const { occupe, agir } = useAgir();
  if (!avances.length) return <Empty>{t('No advance.')}</Empty>;
  return (
    <div>
      {[...avances].sort((a, b) => b.id - a.id).map(a => {
        const st = STATUTS_AVANCE[a.statut], decide = decideAvance(d, user, a), nom = d.personName(a.empId);
        const sejour = a.voyageId ? rattachement(d, { voyageId: a.voyageId, missionId: null, projet: null }) : a.missionId ? rattachement(d, { voyageId: null, missionId: a.missionId, projet: null }) : t('No link');
        return (
          <div key={a.id} className="list-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}><Two main={`${avecNom ? `${nom} — ` : ''}${t('Advance no. ')}${a.id}`} sub={`${sejour}${t(' · requested on #fem')}${fmtIso(a.demandeLe.slice(0, 10))}`} /></div>
            <Tag cls={st.cls}>{t(st.label)}</Tag>
            <span className="tnum">{euros(a.montant)}</span>
            {decide && <Btn small variant="primary" disabled={occupe} onClick={agir(() => run('frais.avance.valider', { id: a.id }))}>{t('Approve')}</Btn>}
            {decide && <Btn small onClick={() => openDialog({ type: 'confirmer', c: refusAvance(a, nom) })}>{t('Refuse')}</Btn>}
            {a.statut === 'demandee' && a.empId === user.empId && user.role !== 'rh' && <Btn small disabled={occupe} onClick={agir(() => run('frais.avance.annuler', { id: a.id }))}>{t('Cancel')}</Btn>}
          </div>
        );
      })}
    </div>
  );
}

/** Véhicules personnels déclarés (indemnités kilométriques). */
export function Vehicules({ empId }: { empId: number }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const vehicules = (d.ds.vehiculesPerso ?? []).filter(v => v.empId === empId).sort((a, b) => b.du.localeCompare(a.du));
  return (
    <Panel title={t('Personal vehicle')} aside={<Btn small onClick={() => openDialog({ type: 'fraisVehicule', empId })}>{t('Declare a vehicle')}</Btn>}>
      {vehicules.length ? vehicules.map(v => (
        <div key={v.id} className="list-row"><Two main={`${TYPES_VEHICULE[v.type]} · ${v.cv} CV${v.electrique ? t(' · electric') : ''}`} sub={`${t('since #le')}${fmtIso(v.du)}${v.au ? `${t(' until #le')}${fmtIso(v.au)}` : ''}`} /></div>
      )) : <Empty>{t('No vehicle declared: declare it for your mileage allowances.')}</Empty>}
    </Panel>
  );
}

