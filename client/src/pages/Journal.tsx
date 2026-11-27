// Journal des actions (Paramètres ; droit « rh » ou « consultation », shared/journal.ts) : vue, période, personne,
// action et salarié concerné ; pagination, export CSV des lignes filtrées ; archive des actions liées à la paie,
// consultée sur demande. Historique d'une fiche (Collaborateurs) : les dernières actions qui concernent le salarié.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArchiveIcon, ArrowClockwiseIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { ESPACE_LABEL } from '../../../shared/constants.ts';
import { fmt, matricule } from '../../../shared/format.ts';
import { t, tn } from '../i18n/langue.ts';
import {
  CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_JOURNAL_MOIS, changementsTexte, dossierComplet, FAMILLES_JOURNAL, familleAction, JOURNAL_LABEL,
  lecteurJournal, libelleAction,
} from '../../../shared/journal.ts';
import { api, type FiltreJournal, type LigneJournal, type PageJournal, type VueJournal } from '../api.ts';
import { ChoixCollaborateur } from '../components/ChoixCollaborateur.tsx';
import { Field } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Panel, Seg, Two } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

/** Espace d'un auteur : libellés de shared/constants.ts (en français), service RH et intégration traduits au rendu. */
const ROLE_LABEL: Record<string, string> = { ...ESPACE_LABEL, rh: 'HR department', integration: 'Integration' };
const roleLabel = (r: string) => (r === 'rh' || r === 'integration' ? t(ROLE_LABEL[r]) : ROLE_LABEL[r] ?? r);
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 };
// Libellés des vues : chaînes sources anglaises, traduites au rendu.
const VUES: [Exclude<VueJournal, 'archive'>, string][] = [['tout', 'All#everything'], ['operations', 'Operations'], ['connexions', 'Sign-ins and access'], ['keystone', 'Calls from Keystone']];
const ans = (mois: number) => tn(mois / 12, 'year#count', 'years#count');

/** Codes connus, rangés par famille (filtre « Action ») ; la saisie d'heures n'est inscrite que comme correction. */
const CODES_PAR_FAMILLE = FAMILLES_JOURNAL.map(f => ({
  f, codes: Object.keys(JOURNAL_LABEL).filter(c => c !== 'temps.setCell' && familleAction(c)?.id === f.id).sort((a, b) => libelleAction(a).localeCompare(libelleAction(b), 'fr')),
}));

/** Noms des salariés concernés (le service RH voit tous les collaborateurs) ; un salarié supprimé garde son matricule. */
function useNoms() {
  const data = useData();
  return useMemo(() => {
    const m = new Map(data.employes.map(e => [e.id, e.nom]));
    return (ids: number[]) => ids.map(id => m.get(id) ?? matricule(id)).join(', ');
  }, [data.employes]);
}

const heure = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Journal des actions : droit « rh » ou « consultation » (lecture seule) ; rien pour un autre profil de l'espace RH. */
export function JournalPanel() {
  const { user } = useData();
  return lecteurJournal(user) ? <PanneauJournal /> : null;
}

function PanneauJournal() {
  const data = useData();
  const { notify } = useStore();
  const noms = useNoms();
  const [vue, setVue] = useState<VueJournal>('tout');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [action, setAction] = useState('');
  const [salarie, setSalarie] = useState<number | null>(null);
  // Personne : appliquée après une courte pause de frappe.
  const [auteurSaisi, setAuteurSaisi] = useState('');
  const [auteur, setAuteur] = useState('');
  useEffect(() => {
    const minuteur = setTimeout(() => setAuteur(auteurSaisi.trim()), 350);
    return () => clearTimeout(minuteur);
  }, [auteurSaisi]);
  const filtre: FiltreJournal = useMemo(() => ({ vue, du, au, auteur, action, salarie }), [vue, du, au, auteur, action, salarie]);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filtre]);

  // Rechargé au changement de filtre ou de page, et à chaque nouvel instantané (donc après chaque action).
  const [res, setRes] = useState<PageJournal | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(() => {
    let annule = false;
    api.journal(filtre, page)
      .then(r => { if (!annule) { setRes(r); setErreur(null); } })
      .catch(err => { if (!annule) setErreur((err as Error).message); });
    return () => { annule = true; };
  }, [filtre, page]);
  useEffect(() => charger(), [data, charger]);

  const [exportEnCours, setExportEnCours] = useState(false);
  const exporter = async () => {
    setExportEnCours(true);
    try {
      await api.journalCsv(filtre);
      notify(`${t('Log exported in CSV format')}${res ? ` — ${tn(res.total, 'line', 'lines')}` : ''}`);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setExportEnCours(false);
    }
  };

  const filtres = !!(du || au || auteur || action || salarie);
  const effacer = () => { setDu(''); setAu(''); setAuteurSaisi(''); setAuteur(''); setAction(''); setSalarie(null); };
  const archive = vue === 'archive';
  const lignes = res?.lignes ?? null;
  const debut = res && res.total ? (res.page - 1) * res.taille + 1 : 0;
  const fin = res ? Math.min(res.total, res.page * res.taille) : 0;
  const pages = res ? Math.max(1, Math.ceil(res.total / res.taille)) : 1;
  const employes = useMemo(() => [...data.employes].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), [data.employes]);

  return (
    <Panel title={t(archive ? 'Action log — payroll archive' : 'Action log')} aside={
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {archive
          ? <Btn small onClick={() => setVue('tout')}>{t('Back to the log')}</Btn>
          : <Seg name="journal-vue" label={t('Lines of the log')} value={vue} onChange={setVue} options={VUES.map(([k, l]) => [k, t(l)] as [Exclude<VueJournal, 'archive'>, string])} style={{ flexWrap: 'wrap' }} />}
        <Btn small icon={<ArrowClockwiseIcon size={14} />} onClick={() => charger()}>{t('Refresh')}</Btn>
        <Btn small variant="secondary" icon={<DownloadSimpleIcon size={14} />} disabled={exportEnCours || !res?.total} onClick={exporter}>{t('Export as CSV')}</Btn>
      </div>
    }>
      <div className="journal-filtres">
        <Field label={t('From#date')} htmlFor="journal-du">
          <input id="journal-du" className="input" type="date" value={du} max={au || undefined} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label={t('To#date-cap')} htmlFor="journal-au">
          <input id="journal-au" className="input" type="date" value={au} min={du || undefined} onChange={e => setAu(e.target.value)} />
        </Field>
        <Field label={t('Person')} htmlFor="journal-auteur">
          <input id="journal-auteur" className="input" type="search" placeholder={t('Name or login')} value={auteurSaisi} onChange={e => setAuteurSaisi(e.target.value)} />
        </Field>
        <Field label={t('Action')} htmlFor="journal-action">
          <select id="journal-action" className="input" value={action} onChange={e => setAction(e.target.value)}>
            <option value="">{t('All actions')}</option>
            {CODES_PAR_FAMILLE.map(({ f, codes }) => (
              <optgroup key={f.id} label={f.label}>
                <option value={`famille:${f.id}`}>{`${f.label}${t(' — all#fem')}`}</option>
                {codes.map(c => <option key={c} value={c}>{libelleAction(c)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label={t('Employee concerned')} htmlFor="journal-salarie">
          <ChoixCollaborateur id="journal-salarie" emps={employes} valeur={salarie} onChange={setSalarie} vide={t('All employees#salarie')} />
        </Field>
        {filtres && <div className="fin"><Btn small onClick={effacer}>{t('Clear the filters')}</Btn></div>}
      </div>

      {archive
        ? <NoteAccent>{`${t('Actions linked to payroll (approvals, extensions and cancellations of absences, corrections of hours, transmissions) of more than a year: kept ')}${ans(CONSERVATION_ARCHIVE_PAIE_MOIS)}${t(', consulted on request. Each consultation is traced.')}`}</NoteAccent>
        : <Fine>{`${t('Lines kept ')}${ans(CONSERVATION_JOURNAL_MOIS)}${t('. Beyond, the actions linked to payroll go into an archive kept ')}${ans(CONSERVATION_ARCHIVE_PAIE_MOIS)}${t(', the others are deleted. No passport number, password, free text nor health data appears there.')}`}</Fine>}

      {erreur && <p className="form-error">{erreur}</p>}
      {lignes == null && !erreur && <Empty pad="sm">{t('Loading the log…')}</Empty>}
      {lignes != null && lignes.length === 0 && (
        <Empty pad="sm">{filtres ? t('No line matches these filters.') : archive ? t('The payroll archive is empty.') : vue === 'connexions' ? t('No sign-in recorded.') : vue === 'keystone' ? t('No call from Keystone recorded.') : t('No action recorded.')}</Empty>
      )}
      {lignes != null && lignes.length > 0 && (
        <div className="scroll-x" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>{t('Date / time')}</th><th>{t('Author')}</th><th>{t('Action')}</th><th>{t('Employee#salarie')}</th><th>{t('Message')}</th></tr></thead>
            <tbody>
              {lignes.map(j => <LigneTable key={j.id} j={j} noms={noms} />)}
            </tbody>
          </table>
        </div>
      )}

      <div className="journal-pied">
        <span className="text-muted sub">{res ? (res.total ? `${t('Lines ')}${debut}${t(' to#range')}${fin}${t(' out of ')}${res.total}` : '') : ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {pages > 1 && <>
            <Btn small disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('More recent')}</Btn>
            <span className="text-muted sub tnum">{`${t('Page ')}${page}${t(' out of ')}${pages}`}</span>
            <Btn small disabled={page >= pages} onClick={() => setPage(p => p + 1)}>{t('Older')}</Btn>
          </>}
          {!archive && <Btn small icon={<ArchiveIcon size={14} />} onClick={() => setVue('archive')}>{t('Consult the payroll archive')}</Btn>}
        </div>
      </div>
    </Panel>
  );
}

function LigneTable({ j, noms }: { j: LigneJournal; noms: (ids: number[]) => string }) {
  const at = new Date(j.at);
  const changements = changementsTexte(j.details);
  return (
    <tr>
      <td><Two main={fmt(at)} sub={heure(at)} nowrap /></td>
      <td><Two main={j.actor} sub={[j.role && roleLabel(j.role), j.identifiant].filter(Boolean).join(' · ')} nowrap /></td>
      <td><Two main={libelleAction(j.action)} sub={<span style={MONO}>{j.action}</span>} /></td>
      <td className="text-muted" style={{ fontSize: 13 }}>{j.salaries.length ? noms(j.salaries) : '—'}</td>
      <td className="text-muted" style={{ fontSize: 13 }}>
        {j.message ?? '—'}
        {changements && <div className="sub text-n400">{changements}</div>}
      </td>
    </tr>
  );
}

/**
 * Fiche d'un salarié : dernières actions qui le concernent (lecteurs du journal : droit « rh » ou « consultation »),
 * et export de toutes ses données (droit « rh » seul : le dossier complet porte des données de santé). Rien pour
 * les autres profils, sans appel au serveur (qui tracerait un refus).
 */
export function HistoriqueFiche({ empId }: { empId: number }) {
  const { user } = useData();
  return lecteurJournal(user) ? <Historique empId={empId} exportable={dossierComplet(user)} /> : null;
}

function Historique({ empId, exportable }: { empId: number; exportable: boolean }) {
  const data = useData();
  const { notify } = useStore();
  const [lignes, setLignes] = useState<LigneJournal[] | null>(null);
  const [total, setTotal] = useState(0);
  const [taille, setTaille] = useState(5);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let annule = false;
    api.journal({ vue: 'tout', salarie: empId }, 1, taille)
      .then(r => { if (!annule) { setLignes(r.lignes); setTotal(r.total); setErreur(null); } })
      .catch(err => { if (!annule) setErreur((err as Error).message); });
    return () => { annule = true; };
  }, [empId, taille, data]);
  useEffect(() => setTaille(5), [empId]);

  const exporter = async () => {
    try {
      await api.donneesSalarie(empId);
      notify(t('Data of the employee exported (JSON file) — export traced in the log'));
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  return (
    <>
      <div className="item-head" style={{ alignItems: 'center' }}>
        <h4 className="section-label">{t('History')}</h4>
        {exportable && <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} title={t('Right of access (GDPR, art. 15): all their data and the log of the actions concerning them')}>{t('Export their data')}</Btn>}
      </div>
      {erreur && <p className="form-error">{erreur}</p>}
      {lignes != null && lignes.length === 0 && <Empty pad="sm">{t('No action recorded on this employee.')}</Empty>}
      {lignes != null && lignes.length > 0 && (
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {lignes.map(j => {
            const at = new Date(j.at);
            const changements = changementsTexte(j.details);
            return (
              <div key={j.id} className="list-row stack" style={{ gap: 2, padding: 'var(--space-3) 0' }}>
                <div className="item-head">
                  <div style={{ fontSize: 13 }}>{libelleAction(j.action)}</div>
                  <span className="text-muted sub nowrap">{fmt(at)}</span>
                </div>
                {j.message && <div className="text-muted sub">{j.message}</div>}
                {changements && <div className="sub text-n400">{changements}</div>}
                <div className="sub text-n400">{`${j.actor}${j.role ? ` · ${roleLabel(j.role)}` : ''}`}</div>
              </div>
            );
          })}
        </div>
      )}
      {lignes != null && total > lignes.length && (
        <div><Btn small onClick={() => setTaille(n => Math.min(200, n + 20))}>{`${t('Show more (')}${total - lignes.length}${t(' others)')}`}</Btn></div>
      )}
    </>
  );
}
