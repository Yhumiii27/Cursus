// Écran Formations, Passeport de prévention (lot 7, chantier B, t066 ; shared/rules/passeport-prevention.ts) : lignes à
// déclarer sur la plateforme — certifications et formations suivies des formations marquées au catalogue (Référentiels →
// Formations) — par année civile, et celles déjà déclarées. Service RH et référent HSE : export CSV (produit et tracé par
// le serveur, qui seul lit la date de naissance), lignes notées déclarées, marque retirée ; la lecture seule consulte.
// Le format d'import de la plateforme n'est pas connu : gabarit de colonnes réglé dans Paramètres, mention « à confirmer ».
import { useMemo, useState } from 'react';
import { CheckSquareIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { fmtIso } from '../../../shared/format.ts';
import { lignesPasseport, MENTION_PASSEPORT, plageLigne } from '../../../shared/rules/passeport-prevention.ts';
import type { LignePasseport } from '../../../shared/types.ts';
import { api } from '../api.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { usePagination } from './tri.ts';
import { SuiteListe } from './TriListe.tsx';
import { Btn, Empty, Fine, Panel, Seg, Tag, Two } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

type Vue = 'a-declarer' | 'declarees';

/** Retrait d'une marque posée par erreur : la ligne est de nouveau proposée à l'export. */
const retrait = (l: LignePasseport, nom: string): Confirmation => ({
  titre: t('Remove the “declared” mark'),
  question: `${t('Remove the mark of ')}${fmtIso(l.declareLe!)}${t(' on “')}${l.intitule}${t('” of ')}${nom} ?`,
  suites: [t('The line is offered again for export.'), t('Nothing is changed on the Prevention passport platform.')],
  bouton: t('Remove the mark'),
  action: 'passeport.retirer',
  payload: { cle: l.cle },
});

/** « 7 h », « 3,5 h », ou « durée inconnue ». */
const duree = (n: number | null) => (n == null ? t('unknown duration') : `${String(n).replace('.', ',')} h`);

export function PasseportPrevention() {
  const d = useDomain();
  const { formations: peut, consultation } = useRole();
  const { openDialog, notify } = useStore();
  const annee = Number(d.ti.slice(0, 4));
  const [an, setAn] = useState(annee);
  const [vue, setVue] = useState<Vue>('a-declarer');
  const [busy, setBusy] = useState(false);
  // Dernier export des lignes à déclarer fait depuis l'écran : clés renvoyées par le serveur (null : liste trop longue pour
  // l'en-tête), proposées seules à la marque « déclarées ». Perdu au rechargement : les lignes se cochent alors à la main.
  const [exporte, setExporte] = useState<{ an: number; cles: string[] | null } | null>(null);
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
      const r = await api.passeportPrevention(du, au, vue);
      if (vue === 'a-declarer') setExporte({ an, cles: r.cles });
      notify(`${t('Prevention passport: ')}${tn(r.nombre, 'line exported', 'lines exported')}`
        + (r.interimaires ? ` (${tn(r.interimaires, 'line of a temp worker set aside', 'lines of temp workers set aside')}${t(': declared by the agency)')}` : '')
        + t(' — export recorded in the log'));
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
          <h2>{t('Prevention passport')}</h2>
          <div className="text-muted sub">
            {tn(aDeclarer.length, 'line to declare', 'lines to declare')} · {tn(declarees.length, 'already declared', 'already declared#fem-plural')}{t(' in #year')}{an}
            {' '}· {tn(marquees, 'training course marked', 'training courses marked')}{t(' in the catalogue')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <label htmlFor="passeport-annee" className="sr-only">{t('Year')}</label>
          <select className="input" id="passeport-annee" value={an} onChange={e => setAn(Number(e.target.value))} style={{ maxWidth: 110 }}>
            {annees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <Seg name="passeportVue" label={t('Lines shown')} value={vue} onChange={setVue} options={[['a-declarer', t('To declare')], ['declarees', t('Already declared#fem-plural-cap')]]} />
          {peut && lignes.length > 0 && <Btn variant="secondary" small icon={<DownloadSimpleIcon size={14} />} disabled={busy} onClick={exporter}>{t('Export (CSV)')}</Btn>}
          {peut && vue === 'a-declarer' && aDeclarer.length > 0 && (
            <Btn variant="secondary" small icon={<CheckSquareIcon size={14} />} onClick={() => openDialog({ type: 'passeportDeclarer', du, au, exportees: exporte?.an === an ? exporte.cles : null })}>
              {t('Mark as declared…')}
            </Btn>
          )}
        </div>
      </div>
    }>
      {lignes.length === 0
        ? <Empty pad="sm">{`${vue === 'a-declarer' ? t('No line to declare in ') : t('No line declared in ')}${an}.`}</Empty>
        : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Training course')}</th><th>{t('Dates')}</th><th>{t('Duration')}</th><th>{t('Result')}</th><th>{t('State')}</th></tr></thead>
              <tbody>
                {page.lignes.map(l => {
                  const e = d.emp(l.empId);
                  return (
                    <tr key={l.cle}>
                      <td>
                        <Two main={e?.nom ?? '—'} sub={e?.matriculePaie ? `${t('employee no. ')}${e.matriculePaie}` : t('no payroll number')} />
                        {l.interim && <Tag cls="tag-outline">{t('Temp worker: see with the agency')}</Tag>}
                      </td>
                      <td><Two main={l.intitule} sub={l.organisme || undefined} /></td>
                      <td className="nowrap">{plageLigne(l)}</td>
                      <td className="nowrap">{duree(l.duree)}</td>
                      <td>{l.resultat}</td>
                      <td className="nowrap">
                        {l.declareLe
                          ? <>
                            <Tag cls="tag-neutral">{t('Declared on#fem')} {fmtIso(l.declareLe)}</Tag>
                            {peut && <Btn small onClick={() => openDialog({ type: 'confirmer', c: retrait(l, e?.nom ?? t('this employee')) })}>{t('Remove')}</Btn>}
                          </>
                          : <Tag cls="tag-accent">{t('To declare')}</Tag>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <SuiteListe p={page} unite={['line', 'lines']} />
      <Fine>
        {MENTION_PASSEPORT}{t(' (Caisse des dépôts): export columns set in Settings → Prevention passport; the first name is the first word of the name on the sheet, to check for a compound first name. Cursus does not hold the NIR: matching by the payroll number in Sage. Offered are the certifications and training followed of the training courses ticked “Prevention passport” in Reference data → Training; a line marked declared is no longer offered. “Mark as declared” only ticks by default the lines of the last export. Training of a temp worker is in principle declared by the temporary work agency: it is set aside from the export.')}
      </Fine>
    </Panel>
  );
}
