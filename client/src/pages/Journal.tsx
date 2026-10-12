// Journal des actions (Paramètres, service RH) : vue, période, personne, action et salarié concerné ; pagination,
// export CSV des lignes filtrées ; archive des actions liées à la paie, consultée sur demande. Historique d'une
// fiche (Collaborateurs) : les dernières actions qui concernent le salarié.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArchiveIcon, ArrowClockwiseIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { ESPACE_LABEL } from '../../../shared/constants.ts';
import { fmt, matricule, plural } from '../../../shared/format.ts';
import {
  CONSERVATION_ARCHIVE_PAIE_MOIS, CONSERVATION_JOURNAL_MOIS, changementsTexte, FAMILLES_JOURNAL, familleAction, JOURNAL_LABEL, libelleAction,
} from '../../../shared/journal.ts';
import { api, type FiltreJournal, type LigneJournal, type PageJournal, type VueJournal } from '../api.ts';
import { Field } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Panel, Seg, Two } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

const ROLE_LABEL: Record<string, string> = { ...ESPACE_LABEL, rh: 'Service RH', integration: 'Intégration' };
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 };
const VUES: [Exclude<VueJournal, 'archive'>, string][] = [['tout', 'Tout'], ['operations', 'Opérations'], ['connexions', 'Connexions et accès'], ['keystone', 'Appels de Keystone']];
const ans = (mois: number) => plural(mois / 12, 'an', 'ans');

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

export function JournalPanel() {
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
    const t = setTimeout(() => setAuteur(auteurSaisi.trim()), 350);
    return () => clearTimeout(t);
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
      notify(`Journal exporté au format CSV${res ? ` — ${plural(res.total, 'ligne', 'lignes')}` : ''}`);
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
    <Panel title={archive ? 'Journal des actions — archive paie' : 'Journal des actions'} aside={
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {archive
          ? <Btn small onClick={() => setVue('tout')}>Revenir au journal</Btn>
          : <Seg name="journal-vue" label="Lignes du journal" value={vue} onChange={setVue} options={VUES} style={{ flexWrap: 'wrap' }} />}
        <Btn small icon={<ArrowClockwiseIcon size={14} />} onClick={() => charger()}>Actualiser</Btn>
        <Btn small variant="secondary" icon={<DownloadSimpleIcon size={14} />} disabled={exportEnCours || !res?.total} onClick={exporter}>Exporter en CSV</Btn>
      </div>
    }>
      <div className="journal-filtres">
        <Field label="Du" htmlFor="journal-du">
          <input id="journal-du" className="input" type="date" value={du} max={au || undefined} onChange={e => setDu(e.target.value)} />
        </Field>
        <Field label="Au" htmlFor="journal-au">
          <input id="journal-au" className="input" type="date" value={au} min={du || undefined} onChange={e => setAu(e.target.value)} />
        </Field>
        <Field label="Personne" htmlFor="journal-auteur">
          <input id="journal-auteur" className="input" type="search" placeholder="Nom ou identifiant" value={auteurSaisi} onChange={e => setAuteurSaisi(e.target.value)} />
        </Field>
        <Field label="Action" htmlFor="journal-action">
          <select id="journal-action" className="input" value={action} onChange={e => setAction(e.target.value)}>
            <option value="">Toutes les actions</option>
            {CODES_PAR_FAMILLE.map(({ f, codes }) => (
              <optgroup key={f.id} label={f.label}>
                <option value={`famille:${f.id}`}>{`${f.label} — toutes`}</option>
                {codes.map(c => <option key={c} value={c}>{libelleAction(c)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Salarié concerné" htmlFor="journal-salarie">
          <select id="journal-salarie" className="input" value={salarie ?? ''} onChange={e => setSalarie(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Tous les salariés</option>
            {employes.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
          </select>
        </Field>
        {filtres && <div className="fin"><Btn small onClick={effacer}>Effacer les filtres</Btn></div>}
      </div>

      {archive
        ? <NoteAccent>{`Actions liées à la paie (validations, corrections d’heures, transmissions) de plus d’un an : conservées ${ans(CONSERVATION_ARCHIVE_PAIE_MOIS)}, consultées sur demande. Chaque consultation est tracée.`}</NoteAccent>
        : <Fine>{`Lignes conservées ${ans(CONSERVATION_JOURNAL_MOIS)}. Au-delà, les actions liées à la paie passent dans une archive conservée ${ans(CONSERVATION_ARCHIVE_PAIE_MOIS)}, les autres sont supprimées. Aucun numéro de passeport, mot de passe, texte libre ni donnée de santé n’y figure.`}</Fine>}

      {erreur && <p className="form-error">{erreur}</p>}
      {lignes == null && !erreur && <Empty pad="sm">Chargement du journal…</Empty>}
      {lignes != null && lignes.length === 0 && (
        <Empty pad="sm">{filtres ? 'Aucune ligne ne correspond à ces filtres.' : archive ? 'L’archive paie est vide.' : vue === 'connexions' ? 'Aucune connexion enregistrée.' : vue === 'keystone' ? 'Aucun appel de Keystone enregistré.' : 'Aucune action enregistrée.'}</Empty>
      )}
      {lignes != null && lignes.length > 0 && (
        <div className="scroll-x" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>Date / heure</th><th>Auteur</th><th>Action</th><th>Salarié</th><th>Message</th></tr></thead>
            <tbody>
              {lignes.map(j => <LigneTable key={j.id} j={j} noms={noms} />)}
            </tbody>
          </table>
        </div>
      )}

      <div className="journal-pied">
        <span className="text-muted sub">{res ? (res.total ? `Lignes ${debut} à ${fin} sur ${res.total}` : '') : ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {pages > 1 && <>
            <Btn small disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Plus récentes</Btn>
            <span className="text-muted sub tnum">{`Page ${page} sur ${pages}`}</span>
            <Btn small disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Plus anciennes</Btn>
          </>}
          {!archive && <Btn small icon={<ArchiveIcon size={14} />} onClick={() => setVue('archive')}>Consulter l’archive paie</Btn>}
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
      <td><Two main={j.actor} sub={[j.role && (ROLE_LABEL[j.role] ?? j.role), j.identifiant].filter(Boolean).join(' · ')} nowrap /></td>
      <td><Two main={libelleAction(j.action)} sub={<span style={MONO}>{j.action}</span>} /></td>
      <td className="text-muted" style={{ fontSize: 13 }}>{j.salaries.length ? noms(j.salaries) : '—'}</td>
      <td className="text-muted" style={{ fontSize: 13 }}>
        {j.message ?? '—'}
        {changements && <div className="sub text-n400">{changements}</div>}
      </td>
    </tr>
  );
}

/** Fiche d'un salarié (service RH) : dernières actions qui le concernent, et export de toutes ses données. */
export function HistoriqueFiche({ empId }: { empId: number }) {
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
      notify('Données du salarié exportées (fichier JSON) — export tracé dans le journal');
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  return (
    <>
      <div className="item-head" style={{ alignItems: 'center' }}>
        <h4 className="section-label">Historique</h4>
        <Btn small icon={<DownloadSimpleIcon size={14} />} onClick={exporter} title="Droit d’accès (RGPD, art. 15) : toutes ses données et le journal des actions le concernant">Exporter ses données</Btn>
      </div>
      {erreur && <p className="form-error">{erreur}</p>}
      {lignes != null && lignes.length === 0 && <Empty pad="sm">Aucune action enregistrée sur ce salarié.</Empty>}
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
                <div className="sub text-n400">{`${j.actor}${j.role ? ` · ${ROLE_LABEL[j.role] ?? j.role}` : ''}`}</div>
              </div>
            );
          })}
        </div>
      )}
      {lignes != null && total > lignes.length && (
        <div><Btn small onClick={() => setTaille(t => Math.min(200, t + 20))}>{`Afficher plus (${total - lignes.length} autres)`}</Btn></div>
      )}
    </>
  );
}
