// Écran Prévention, compte professionnel de prévention (t052, shared/rules/c2p.ts) : par salarié et par année civile, nuits
// comptées d'après les horaires de poste des feuilles validées (au moins 1 h entre 0 h et 5 h), à part celles des équipes
// successives alternantes, seuils réglementaires au prorata de la période du contrat, facteurs cochés sur le poste occupé.
// Synthèse calculée par le serveur (`Dataset.c2p`) pour le service RH, le référent HSE et la lecture seule ; export CSV
// « à saisir dans la DSN » pour la paie (codes à confirmer), tracé au journal avec son nombre de lignes (downloadCsv).
// Qualifier les horaires et cocher les facteurs : Référentiels, onglets Horaires et Postes.
import { useMemo, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { FACTEURS_C2P } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { ARTICLE_C2P, C2P_SEUIL_ALTERNANT, C2P_SEUIL_NUIT, exportC2p } from '../../../shared/rules/c2p.ts';
import type { LigneC2p } from '../../../shared/types.ts';
import { Btn, Chips, Empty, Fine, Kpi, Kpis, NoteAccent, Page, Panel, Seg, Tag, Two } from '../components/ui.tsx';
import { SuiteListe } from '../components/TriListe.tsx';
import { usePagination } from '../components/tri.ts';
import { downloadCsv } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { t, tn } from '../i18n/langue.ts';
import { useStore } from '../state/store.tsx';

/** Seuil affiché : « 120 », « 60,5 » au prorata. */
const seuil = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Nuits comptées et seuil, avec l'étiquette « exposé » au-delà. */
function Compte({ n, s, expose }: { n: number; s: number; expose: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span className="tnum">{n} / {seuil(s)}</span>
      {expose && <Tag cls="tag-accent">{t('Exposed')}</Tag>}
    </div>
  );
}

/** À signaler sur la ligne : nuits sous un horaire à qualifier, semaines sans horaire, feuilles pas encore validées. */
function signalements(l: LigneC2p): string[] {
  return [
    l.nuitsAQualifier ? `${tn(l.nuitsAQualifier, 'night', 'nights')}${t(' under a schedule to qualify')}` : '',
    l.nuitsAQualifier && l.nuitsAlternantes < l.seuilAlternant && l.nuitsAlternantes + l.nuitsAQualifier >= l.seuilAlternant ? t('alternating shifts threshold reached if the schedule is alternating') : '',
    l.semainesSansHoraire ? `${tn(l.semainesSansHoraire, 'week', 'weeks')}${t(' without a schedule (no night counted)')}` : '',
    l.feuillesNonValidees ? `${tn(l.feuillesNonValidees, 'timesheet', 'timesheets')}${l.feuillesNonValidees > 1 ? t(' not yet approved#plural') : t(' not yet approved')}` : '',
  ].filter(Boolean);
}

export function Prevention() {
  const d = useDomain();
  const { go } = useStore();
  const syntheses = d.ds.c2p ?? [];
  const [annee, setAnnee] = useState(syntheses[0]?.annee ?? Number(d.ti.slice(0, 4)));
  const [filtre, setFiltre] = useState<'exposes' | 'tous'>('exposes');
  const s = syntheses.find(x => x.annee === annee) ?? syntheses[0] ?? null;
  // Par défaut : les salariés exposés, et ceux qui ont des nuits sous un horaire à qualifier (leur exposition en dépend).
  const lignes = useMemo(() => (s?.lignes ?? []).filter(l => filtre === 'tous' || l.expositions.length > 0 || l.nuitsAQualifier > 0)
    .map(l => ({ l, e: d.emp(l.empId) })).filter(x => !!x.e).sort((a, b) => a.e!.nom.localeCompare(b.e!.nom, 'fr')), [s, filtre, d]);
  const page = usePagination(lignes, `${annee}|${filtre}`);
  if (!s) return <Page title={t('Exposures (C2P)')}><Empty>{t('Summary unavailable for this profile.')}</Empty></Page>;

  const declares = s.lignes.filter(l => l.declarant === 'employeur');
  const compte = (f: string) => declares.filter(l => l.expositions.includes(f as LigneC2p['expositions'][number])).length;
  const exposes = declares.filter(l => l.expositions.length > 0).length;
  const x = exportC2p(d.ds, s);
  const enCours = s.annee === Number(s.arrete.slice(0, 4));
  const sansHoraire = s.lignes.filter(l => l.semainesSansHoraire > 0).length, nonValidees = s.lignes.filter(l => l.feuillesNonValidees > 0).length;

  return (
    <Page kicker={`${t('Occupational prevention account')} · ${enCours ? `${t('current year, as of ')}${fmtIso(s.arrete)}` : `${t('year ')}${s.annee}`}`} title={t('Exposures (C2P)')}
      actions={<>
        {syntheses.length > 1 && <Seg name="c2pAnnee" label={t('Year')} value={s.annee} onChange={setAnnee} options={syntheses.map(y => [y.annee, String(y.annee)])} />}
        {x.rows.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={() => downloadCsv(x.fichier, x.head, x.rows)}>{t('Export for the DSN (CSV)')}</Btn>}
      </>}>
      <Kpis>
        <Kpi kicker={t('Exposed employees')} value={exposes} sub={`${t('out of ')}${tn(declares.length, 'employee declared', 'employees declared')}${t(' by the employer')}`} />
        <Kpi kicker={FACTEURS_C2P.nuit.label} value={compte('nuit')} sub={t(`${C2P_SEUIL_NUIT} nights a year, pro rata`)} />
        <Kpi kicker={FACTEURS_C2P.alternant.label} value={compte('alternant')} sub={t(`${C2P_SEUIL_ALTERNANT} nights a year, pro rata`)} />
        <Kpi kicker={t('Job factors')} value={declares.filter(l => l.facteursPoste.length > 0).length} sub={t('repetitive, hyperbaric, temperatures, noise')} />
      </Kpis>

      {s.horairesAQualifier.length > 0 && (
        <NoteAccent>
          {tn(s.horairesAQualifier.length, 'night schedule', 'night schedules')}{t(' to qualify, alternating successive shifts or not: ')}
          {s.horairesAQualifier.join(', ')}. {t(`Their nights count as night work (threshold of ${C2P_SEUIL_NUIT}) in the meantime.`)}{' '}
          <Btn small onClick={() => go('referentiels', { refOnglet: 'horaires' })}>{t('Qualify the schedules')}</Btn>
        </NoteAccent>
      )}

      <Panel head={
        <div className="panel-head top">
          <div>
            <h2>{t('Exposures by employee')}</h2>
            <div className="text-muted sub">{tn(s.lignes.length, 'employee under contract', 'employees under contract')}{t(' in ')}{s.annee}</div>
          </div>
          <Seg name="c2pFiltre" label={t('Employees shown')} value={filtre} onChange={setFiltre} options={[['exposes', t('Exposed or to qualify')], ['tous', t('All#masc')]]} />
        </div>
      }>
        {lignes.length === 0 ? <Empty pad="sm">{t(`No employee exposed in ${s.annee}, nor any night under a schedule to qualify.`)}</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Employee')}</th><th>{t('Period')}</th><th>{t('Night work')}</th><th>{t('Alternating shifts')}</th><th>{t('Job factors')}</th><th>{t('Declaration')}</th><th>{t('To check')}</th></tr></thead>
              <tbody>
                {page.lignes.map(({ l, e }) => {
                  const a = signalements(l);
                  return (
                    <tr key={l.empId}>
                      <td><Two main={e!.nom} sub={[e!.poste, e!.equipe].filter(Boolean).join(' · ')} /></td>
                      <td className="nowrap"><Two main={`${fmtIso(l.du)} – ${fmtIso(l.au)}`} sub={l.prorata < 1 ? t(`thresholds pro rata (${Math.round(l.prorata * 100)} % of the year)`) : undefined} /></td>
                      <td><Compte n={l.nuits} s={l.seuilNuit} expose={l.expositions.includes('nuit')} /></td>
                      <td><Compte n={l.nuitsAlternantes} s={l.seuilAlternant} expose={l.expositions.includes('alternant')} /></td>
                      <td>{l.facteursPoste.length
                        ? <Chips items={l.facteursPoste.map(f => ({ key: f, label: FACTEURS_C2P[f].label, cls: 'tag-neutral' }))} />
                        : <span className="text-muted">{t('None')}</span>}</td>
                      <td>{l.declarant === 'employeur'
                        ? (l.expositions.length ? <Tag cls="tag-accent">{tn(l.expositions.length, 'factor', 'factors')}{t(' to declare')}</Tag> : <span className="text-muted">{t('Nothing to declare')}</span>)
                        : l.declarant === 'ett' ? <Two main={t('By the temporary work agency')} sub={t('exposures to send to it')} /> : <Two main={t('Not declared')} sub={t('contract of less than a month')} />}</td>
                      <td>{a.length ? <span className="sub">{a.join(' · ')}</span> : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SuiteListe p={page} unite={['employee#lower', 'employees#lower']} />
        {(sansHoraire > 0 || nonValidees > 0) && (
          <Fine>
            {[sansHoraire ? `${tn(sansHoraire, 'employee has', 'employees have')}${t(' approved weeks without a shift schedule: no night is counted in them')}` : '',
              nonValidees ? `${tn(nonValidees, 'employee has', 'employees have')}${t(' timesheets not yet approved: their nights count at approval')}` : ''].filter(Boolean).join(' · ')}
            {' '}{t('(column “To check”, filter “All”).')}
          </Fine>
        )}
        <Fine>
          {t(`A night counts when the shift includes at least 1 h of work between 0:00 and 5:00 (${ARTICLE_C2P}), from the shift schedule frozen on the approved timesheet: Cursus only counts the nights from shift schedules, a timesheet without a schedule counts no night. Nights worked under a schedule qualified “alternating successive shifts” (Reference data → Schedules) count towards the threshold of ${C2P_SEUIL_ALTERNANT} nights, the others towards that of ${C2P_SEUIL_NUIT}; regulatory thresholds, not adjustable, pro rata for a contract of less than a year; a contract of less than a month is not declared. Repetitive work, hyperbaric environment, extreme temperatures and noise are ticked on the job (Reference data → Jobs) when its holders are exposed to them beyond the threshold after protection. The export lists the lines to enter in Sage’s DSN with Cursus’s internal codes and the presumed DSN code, to be confirmed by payroll.`)}
        </Fine>
      </Panel>
    </Page>
  );
}
