// Écran Formations, Passeport de prévention (lot 7, chantier B, t066 ; shared/rules/passeport-prevention.ts) : lignes à
// déclarer sur la plateforme — certifications et formations suivies des formations marquées au catalogue (Référentiels →
// Formations) — par année civile, et celles déjà déclarées. Service RH et référent HSE : export CSV (produit et tracé par
// le serveur, qui seul lit la date de naissance), lignes notées déclarées, marque retirée ; la lecture seule consulte.
// Le format d'import de la plateforme n'est pas connu : gabarit de colonnes réglé dans Paramètres, mention « à confirmer ».
import { useMemo, useState } from 'react';
import { CheckSquareIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { lignesPasseport, MENTION_PASSEPORT, plageLigne } from '../../../shared/rules/passeport-prevention.ts';
import type { LignePasseport } from '../../../shared/types.ts';
import { api } from '../api.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { usePagination } from './tri.ts';
import { SuiteListe } from './TriListe.tsx';
import { Btn, Empty, Fine, Panel, Seg, Tag, Two } from './ui.tsx';

type Vue = 'a-declarer' | 'declarees';

/** Retrait d'une marque posée par erreur : la ligne est de nouveau proposée à l'export. */
const retrait = (l: LignePasseport, nom: string): Confirmation => ({
  titre: 'Retirer la marque « déclarée »',
  question: `Retirer la marque du ${fmtIso(l.declareLe!)} sur « ${l.intitule} » de ${nom} ?`,
  suites: ['La ligne est de nouveau proposée à l’export.', 'Rien n’est modifié sur la plateforme du Passeport de prévention.'],
  bouton: 'Retirer la marque',
  action: 'passeport.retirer',
  payload: { cle: l.cle },
});

/** « 7 h », « 3,5 h », ou « durée inconnue ». */
const duree = (n: number | null) => (n == null ? 'durée inconnue' : `${String(n).replace('.', ',')} h`);

export function PasseportPrevention() {
  const d = useDomain();
  const { formations: peut, consultation } = useRole();
  const { openDialog, notify } = useStore();
  const annee = Number(d.ti.slice(0, 4));
  const [an, setAn] = useState(annee);
  const [vue, setVue] = useState<Vue>('a-declarer');
  const [busy, setBusy] = useState(false);
  const du = `${an}-01-01`, au = an === annee ? d.ti : `${an}-12-31`;
  // Toutes les lignes de l'année (déclarées comprises) : compteurs, puis la vue choisie.
  const toutes = useMemo(() => lignesPasseport(d, { du, au, declarees: true }), [d, du, au]);
  const aDeclarer = toutes.filter(l => !l.declareLe), declarees = toutes.filter(l => l.declareLe);
  const lignes = vue === 'a-declarer' ? aDeclarer : declarees;
  const page = usePagination(lignes, `${an}|${vue}`);
  if (!peut && !consultation) return null;
  const marquees = d.ds.referentiels.formations.filter(f => f.passeportPrevention && !f.archive).length;
  // Années proposées : l'année en cours et les quatre précédentes.
  const annees = [0, 1, 2, 3, 4].map(n => annee - n);

  const exporter = async () => {
    setBusy(true);
    try {
      await api.passeportPrevention(du, au, vue === 'declarees');
      notify(`Passeport de prévention : ${plural(lignes.length, 'ligne exportée', 'lignes exportées')} — export tracé dans le journal`);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel head={
      <div className="panel-head top">
        <div>
          <h2>Passeport de prévention</h2>
          <div className="text-muted sub">
            {plural(aDeclarer.length, 'ligne à déclarer', 'lignes à déclarer')} · {plural(declarees.length, 'déjà déclarée', 'déjà déclarées')} en {an}
            {' '}· {plural(marquees, 'formation marquée', 'formations marquées')} au catalogue
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <label htmlFor="passeport-annee" className="sr-only">Année</label>
          <select className="input" id="passeport-annee" value={an} onChange={e => setAn(Number(e.target.value))} style={{ maxWidth: 110 }}>
            {annees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <Seg name="passeportVue" label="Lignes affichées" value={vue} onChange={setVue} options={[['a-declarer', 'À déclarer'], ['declarees', 'Déjà déclarées']]} />
          {peut && lignes.length > 0 && <Btn variant="secondary" small icon={<DownloadSimpleIcon size={14} />} disabled={busy} onClick={exporter}>Exporter (CSV)</Btn>}
          {peut && vue === 'a-declarer' && aDeclarer.length > 0 && (
            <Btn variant="secondary" small icon={<CheckSquareIcon size={14} />} onClick={() => openDialog({ type: 'passeportDeclarer', cles: aDeclarer.map(l => l.cle), du, au })}>
              Marquer déclarées…
            </Btn>
          )}
        </div>
      </div>
    }>
      {lignes.length === 0
        ? <Empty pad="sm">{vue === 'a-declarer' ? `Aucune ligne à déclarer en ${an}.` : `Aucune ligne déclarée en ${an}.`}</Empty>
        : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Formation</th><th>Dates</th><th>Durée</th><th>Résultat</th><th>État</th></tr></thead>
              <tbody>
                {page.lignes.map(l => {
                  const e = d.emp(l.empId);
                  return (
                    <tr key={l.cle}>
                      <td>
                        <Two main={e?.nom ?? '—'} sub={e?.matriculePaie ? `matricule ${e.matriculePaie}` : 'sans matricule de paie'} />
                        {l.interim && <Tag cls="tag-outline">Intérimaire : voir avec l’agence</Tag>}
                      </td>
                      <td><Two main={l.intitule} sub={l.organisme || undefined} /></td>
                      <td className="nowrap">{plageLigne(l)}</td>
                      <td className="nowrap">{duree(l.duree)}</td>
                      <td>{l.resultat}</td>
                      <td className="nowrap">
                        {l.declareLe
                          ? <>
                            <Tag cls="tag-neutral">Déclarée le {fmtIso(l.declareLe)}</Tag>
                            {peut && <Btn small onClick={() => openDialog({ type: 'confirmer', c: retrait(l, e?.nom ?? 'ce salarié') })}>Retirer</Btn>}
                          </>
                          : <Tag cls="tag-accent">À déclarer</Tag>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <SuiteListe p={page} unite={['ligne', 'lignes']} />
      <Fine>
        {MENTION_PASSEPORT} (Caisse des dépôts) : colonnes de l’export réglées dans Paramètres → Passeport de prévention ; le prénom est le premier
        mot du nom de la fiche, à vérifier pour un prénom composé. Cursus ne détient pas le NIR : rapprochement par le matricule de paie dans Sage.
        Sont proposées les certifications et formations suivies des formations cochées « Passeport de prévention » dans Référentiels → Formations ;
        une ligne marquée déclarée ne l’est plus. Une formation d’intérimaire se déclare en principe par l’entreprise de travail temporaire.
      </Fine>
    </Panel>
  );
}
