// lot 12 — C2 (notes de frais : activation) : historique des notes de frais, lu à la demande (GET /api/frais/historique,
// server/src/frais-historique.ts : mêmes droits que l'instantané, consultation d'autrui tracée par le serveur). Règles sans
// React : components/frais/historique.ts.
// - `NotesAnciennes` : bouton « Notes plus anciennes » de Mes frais et de l'onglet Notes du manager (ses propres notes) ;
// - `RechercheFrais` : onglet « Historique » du service RH et de la comptabilité (salarié, mois, statut, numéro de note) ;
// - `DetailHistorique` : une note en lecture seule (dépenses, justificatifs ouverts par /api/pieces), aussi pour une note de
//   l'instantané payée depuis plus de 2 mois, dont les dépenses n'y sont pas (`DetailNote`, components/frais/Notes.tsx).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClockCounterClockwiseIcon, MagnifyingGlassIcon, PaperclipIcon } from '@phosphor-icons/react';
import { fmtIso } from '../../../../shared/format.ts';
import { FENETRE_FRAIS_MOIS } from '../../../../shared/rules/frais-fenetre.ts';
import { CATEGORIES_FRAIS, STATUTS_NOTE_FRAIS, totauxNote } from '../../../../shared/rules/frais.ts';
import type { NoteFrais, NoteHistoriqueFrais, PageHistoriqueFrais } from '../../../../shared/types.ts';
import { api, lienPiece } from '../../api.ts';
import { useDomain } from '../../state/derived.ts';
import { Field } from '../Dialog.tsx';
import { Ouvrir } from '../Cliquable.tsx';
import { Btn, Empty, Fine, Kpi, Kpis, Panel, Tag, Two } from '../ui.tsx';
import { euros, justificatifs, nomNote, rattachement } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';
import { libellePeriode, lireRecherche, periodeAnciennes, RECHERCHE_VIDE, type SaisieRecherche } from './historique.ts';

/** Lignes d'une page d'historique : une note par ligne (salarié si `avecNom`), statut, total ; un clic ouvre le détail. */
function ListeHistorique({ page, avecNom, ouverte, ouvrir }: { page: Pick<PageHistoriqueFrais, 'notes' | 'totaux'>; avecNom?: boolean; ouverte: number | null; ouvrir: (id: number | null) => void }) {
  const d = useDomain();
  if (!page.notes.length) return <Empty>{t('No expense report over the period.')}</Empty>;
  return (
    <div>
      {page.notes.map(n => {
        const st = STATUTS_NOTE_FRAIS[n.statut], sel = ouverte === n.id, total = page.totaux[n.id];
        const basculer = () => ouvrir(sel ? null : n.id);
        return (
          <div key={n.id} className="list-row top clickable" onClick={basculer} style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <Ouvrir pressed={sel} onOpen={basculer}>{avecNom ? `${d.personName(n.empId)} — ` : ''}{nomNote(n)}</Ouvrir>
              <div className="text-muted sub">{n.payeeLe ? `${t('paid on #fem')}${fmtIso(n.payeeLe)}` : rattachement(d, n) || t('No link')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Tag cls={st.cls}>{st.label}</Tag>
              {total !== undefined && <span className="tnum" style={{ minWidth: 90, textAlign: 'right' }}>{euros(total)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Contenu d'une note lue en base : circuit, totaux, dépenses et justificatifs, en lecture seule. */
function ContenuHistorique({ h }: { h: NoteHistoriqueFrais }) {
  const d = useDomain();
  const n = h.note, tot = totauxNote(h.lignes), st = STATUTS_NOTE_FRAIS[n.statut];
  const circuit = [
    n.soumiseLe && `${t('submitted on #fem')}${fmtIso(n.soumiseLe.slice(0, 10))}`,
    n.controleeLe && `${t('checked on #fem')}${fmtIso(n.controleeLe.slice(0, 10))}`,
    n.payeeLe && `${t('paid on #fem')}${fmtIso(n.payeeLe.slice(0, 10))}`,
    n.annuleeLe && `${t('cancelled on #fem')}${fmtIso(n.annuleeLe.slice(0, 10))}`,
  ].filter(Boolean).join(' · ');
  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag cls={st.cls}>{st.label}</Tag>
        <span className="text-muted sub">{rattachement(d, n) || t('No link')}{circuit ? ` · ${circuit}` : ''}</span>
      </div>
      <Kpis>
        <Kpi kicker={t('Requested#masc')} value={<span className="tnum">{euros(tot.demande)}</span>} />
        <Kpi kicker={t('Reimbursed')} value={<span className="tnum">{euros(tot.retenu)}</span>} sub={tot.refusees ? tn(tot.refusees, 'refused expense', 'refused expenses') : undefined} />
      </Kpis>
      {h.lignes.length === 0 ? <Empty>{t('No expense sent for this note.')}</Empty> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {h.lignes.map(l => {
            const pj = justificatifs(h.pieces, l);
            return (
              <li key={l.id} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', opacity: l.refuseeLe ? 0.7 : 1 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <Two main={`${CATEGORIES_FRAIS[l.categorie].label} · ${fmtIso(l.date)}`} sub={[l.commercant, l.km ? `${String(l.km).replace('.', ',')} km` : null].filter(Boolean).join(' · ') || undefined} />
                  <span style={{ flex: 1 }} />
                  <span className="tnum">
                    {l.devise !== 'EUR' ? `${euros(l.montant, l.devise)} = ` : ''}{euros(l.montantEur)}
                    {l.montantRetenu != null && !l.refuseeLe ? ` → ${euros(l.montantRetenu)}${t(' retained#plural')}` : ''}
                  </span>
                </div>
                {l.refuseeLe && <div className="note-accent">{t('Expense refused at the check')}{l.refusMotif ? `${t(': ')}${l.refusMotif}` : ''}</div>}
                {pj.length > 0 && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }} className="sub">
                    {pj.map(p => <a key={p.id} href={lienPiece(p.id)} target="_blank" rel="noopener noreferrer"><PaperclipIcon size={14} aria-hidden="true" /> {p.nom}</a>)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Lecture d'une note par la route d'historique : état de chargement, erreur en clair. */
function useNoteHistorique(id: number) {
  const [h, setH] = useState<NoteHistoriqueFrais | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    setH(null); setErreur(null);
    api.noteHistoriqueFrais(id).then(r => { if (vivant) setH(r); }).catch((e: Error) => { if (vivant) setErreur(e.message); });
    return () => { vivant = false; };
  }, [id]);
  return { h, erreur };
}

/** Détail d'une note de l'historique, en lecture seule. */
export function DetailHistorique({ id, onClose, titre }: { id: number; onClose: () => void; titre?: string }) {
  const d = useDomain();
  const { h, erreur } = useNoteHistorique(id);
  const nom = h ? `${h.note.empId === d.ds.user.empId ? '' : `${d.personName(h.note.empId)} — `}${nomNote(h.note)}` : titre ?? `${t('Note no. ')}${id}`;
  return (
    <Panel highlight title={nom} aside={<Btn small onClick={onClose}>{t('Close')}</Btn>}>
      {erreur ? <Fine muted={false}>{t('Note not loaded — ')}{erreur}</Fine> : !h ? <Fine>{t('Loading the note…')}</Fine> : <ContenuHistorique h={h} />}
      <Fine>{t('Note archived or paid: read only, loaded on demand.')}</Fine>
    </Panel>
  );
}

/** Pages chargées d'une recherche (une page de plus à chaque « Afficher plus »). */
interface Lu { page: PageHistoriqueFrais; notes: NoteFrais[]; totaux: Record<number, number> }
const cumuler = (avant: Lu | null, page: PageHistoriqueFrais): Lu => ({
  page, notes: [...(avant?.notes ?? []), ...page.notes], totaux: { ...avant?.totaux, ...page.totaux },
});

/**
 * « Notes plus anciennes » du salarié `empId` (Mes frais, onglet Notes du manager) : ses notes des 24 mois de dépenses qui
 * précèdent la fenêtre de l'instantané, à la demande, puis les 24 mois d'avant.
 */
export function NotesAnciennes({ empId }: { empId: number }) {
  const d = useDomain();
  const [rang, setRang] = useState<number | null>(null);
  const [lu, setLu] = useState<Lu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const charger = useCallback(async (r: number, page: number, avant: Lu | null) => {
    setOccupe(true);
    try {
      const p = await api.historiqueFrais({ empId, ...periodeAnciennes(d.ti, r), page });
      setLu(cumuler(avant, p)); setRang(r); setErreur(null);
    } catch (e) { setErreur((e as Error).message); } finally { setOccupe(false); }
  }, [d.ti, empId]);
  if (rang === null) {
    return (
      <div className="frais-actions">
        <Btn small icon={<ClockCounterClockwiseIcon size={14} />} disabled={occupe} onClick={() => void charger(0, 1, null)}>{t('Older notes')}</Btn>
        <Fine>{t('Notes paid more than ')}{FENETRE_FRAIS_MOIS}{t(' months ago: loaded on demand.')}</Fine>
        {erreur && <Fine muted={false}>{t('History not loaded — ')}{erreur}</Fine>}
      </div>
    );
  }
  const periode = periodeAnciennes(d.ti, rang);
  return (
    <>
      {ouverte != null && <DetailHistorique id={ouverte} onClose={() => setOuverte(null)} />}
      <Panel title={t('Older notes')} aside={`${t('expenses of ')}${libellePeriode(periode)}`}>
        {erreur && <Fine muted={false}>{t('History not loaded — ')}{erreur}</Fine>}
        {lu && <ListeHistorique page={lu} ouverte={ouverte} ouvrir={setOuverte} />}
        <div className="frais-actions">
          {lu && lu.page.page < lu.page.pages && <Btn small disabled={occupe} onClick={() => void charger(rang, lu.page.page + 1, lu)}>{t('Show more')}</Btn>}
          <Btn small disabled={occupe} onClick={() => { setOuverte(null); void charger(rang + 1, 1, null); }}>{t('Previous months')}</Btn>
          {rang > 0 && <Btn small disabled={occupe} onClick={() => { setOuverte(null); void charger(rang - 1, 1, null); }}>{t('Following months')}</Btn>}
        </div>
        <Fine>{t('Notes paid more than ')}{FENETRE_FRAIS_MOIS}{t(' months ago: loaded on demand, read only.')}</Fine>
      </Panel>
    </>
  );
}

/**
 * Recherche dans l'historique (service RH, comptabilité ; onglet « Historique ») : salarié, mois des dépenses (24 au plus),
 * statut, ou numéro d'une note. Toute la base, archives comprises ; la consultation des notes d'autrui est tracée.
 */
export function RechercheFrais() {
  const d = useDomain();
  const [saisie, setSaisie] = useState<SaisieRecherche>(RECHERCHE_VIDE);
  const [tente, setTente] = useState(false);
  const [lu, setLu] = useState<Lu | null>(null);
  const [filtres, setFiltres] = useState<Parameters<typeof api.historiqueFrais>[0] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const r = lireRecherche(saisie, d.ti);
  const erreurs = tente && !r.ok ? r.erreurs : {};
  const changer = (k: keyof SaisieRecherche) => (ev: { target: { value: string } }) => setSaisie(s => ({ ...s, [k]: ev.target.value }));
  const charger = async (f: NonNullable<typeof filtres>, page: number, avant: Lu | null) => {
    setOccupe(true);
    try {
      const p = await api.historiqueFrais({ ...f, page });
      setLu(cumuler(avant, p)); setFiltres(f); setErreur(null);
    } catch (e) { setErreur((e as Error).message); } finally { setOccupe(false); }
  };
  const chercher = (ev: FormEvent) => {
    ev.preventDefault();
    setTente(true);
    if (!r.ok) return;
    if (r.note !== null) { setOuverte(r.note); return; }
    setOuverte(null);
    void charger(r.filtres, 1, null);
  };
  const salaries = [...d.ds.annuaire].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return (
    <>
      <Panel title={t('Search for an expense report')} aside={t('the whole base, archived notes included')}>
        <form onSubmit={chercher} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
            <Field label={t('Employee#salarie')} htmlFor="frais-hist-salarie" erreur={erreurs.empId}>
              <select className="input" id="frais-hist-salarie" value={saisie.empId} onChange={changer('empId')} style={{ maxWidth: 280 }}>
                <option value="">{t('All the employees#salaries')}</option>
                {salaries.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </Field>
            <Field label={t('From (month of the expenses)')} htmlFor="frais-hist-du" erreur={erreurs.du}>
              <input className="input" id="frais-hist-du" type="month" value={saisie.du} max={d.ti.slice(0, 7)} onChange={changer('du')} />
            </Field>
            <Field label={t('To#au')} htmlFor="frais-hist-au" erreur={erreurs.au}>
              <input className="input" id="frais-hist-au" type="month" value={saisie.au} max={d.ti.slice(0, 7)} onChange={changer('au')} />
            </Field>
            <Field label={t('Status')} htmlFor="frais-hist-statut" erreur={erreurs.statut}>
              <select className="input" id="frais-hist-statut" value={saisie.statut} onChange={changer('statut')}>
                <option value="">{t('All#masc')}</option>
                {Object.entries(STATUTS_NOTE_FRAIS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label={t('Note no.')} htmlFor="frais-hist-note" erreur={erreurs.note}>
              <input className="input" id="frais-hist-note" inputMode="numeric" value={saisie.note} onChange={changer('note')} style={{ maxWidth: 120 }} />
            </Field>
          </div>
          <div className="frais-actions">
            <Btn small type="submit" variant="primary" icon={<MagnifyingGlassIcon size={14} />} disabled={occupe}>{t('Search')}</Btn>
            {(lu || ouverte != null) && <Btn small onClick={() => { setSaisie(RECHERCHE_VIDE); setTente(false); setLu(null); setFiltres(null); setOuverte(null); }}>{t('Clear')}</Btn>}
          </div>
          <Fine>{t('By default, the last 24 months; 24 months at most per search. A note number opens that note alone. Each consultation of another employee’s notes is recorded in the log.')}</Fine>
        </form>
      </Panel>
      {ouverte != null && <DetailHistorique id={ouverte} onClose={() => setOuverte(null)} />}
      {erreur && <Fine muted={false}>{t('Search impossible — ')}{erreur}</Fine>}
      {lu && filtres && (
        <Panel title={t('Results')} aside={`${tn(lu.page.total, 'note', 'notes')}${t(' · expenses of ')}${libellePeriode(lu.page)}`}>
          <ListeHistorique page={lu} avecNom ouverte={ouverte} ouvrir={setOuverte} />
          {lu.page.page < lu.page.pages && (
            <div className="frais-actions"><Btn small disabled={occupe} onClick={() => void charger(filtres, lu.page.page + 1, lu)}>{t('Show more')} ({tn(lu.page.total - lu.notes.length, 'note left', 'notes left')})</Btn></div>
          )}
        </Panel>
      )}
    </>
  );
}
