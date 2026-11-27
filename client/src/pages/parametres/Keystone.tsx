// Paramètres → Intégration Keystone : niveau de partage des motifs (administrateur RH), routes de l'API entrante,
// état des envois sortants.
import type { EnvoisState } from '../../api.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, SectionLabel, Seg, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { MONO, quand, type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

/** Descriptions : sources anglaises, traduites au rendu. Routes de l'API v1 (préfixe /api/integrations/keystone/v1) ; contrat complet : docs/API-KEYSTONE.md. */
const KEYSTONE_ENDPOINTS: [string, string, string][] = [
  ['PUT', '/projets/:code', 'Project chargeable in the timesheets'],
  ['PUT', '/chantiers/:id', 'Worksite: dates, Go / No Go requirements, active or archived status'],
  ['PUT', '/affectations/:id', 'Presence of an employee on a worksite (assignment and resource of the Go / No Go)'],
  ['PUT', '/taches/:id', 'Planned task: hours planned per day, offered in the timesheet'],
  ['PUT', '/instantane', 'Full synchronisation: reference state of projects, worksites, assignments and tasks'],
  ['GET', '/chantiers/:id/go-no-go', 'Go / No Go verdict of a worksite and its resources'],
  ['POST', '/demandes', 'Trip request for a resource, to approve in Trips'],
];

/** État réel des envois à Keystone : simulation, échecs en cours (non classés), reprise après erreur, ou à jour. */
function KeystoneTag({ mode, etat }: { mode: string; etat: EnvoisState['keystone'] | null }) {
  if (mode !== 'api') return <Tag cls="tag-outline">{t('Simulation')}</Tag>;
  if (!etat) return <Tag cls="tag-outline">{t('API mode')}</Tag>;
  if (etat.echecsEnCours) return <Tag cls="tag-accent">{tn(etat.echecsEnCours, 'failed send', 'failed sends')}</Tag>;
  if (etat.enReprise) return <Tag cls="tag-accent">{t('Keystone does not answer')}</Tag>;
  if (etat.nombres.a_envoyer) return <Tag cls="tag-outline">{t('Sending in progress')}</Tag>;
  return <Tag cls="tag-neutral">{etat.dernierSucces ? t('API · up to date') : t('API · no send')}</Tag>;
}

export function Keystone({ s, envois: { etat: envois } }: SectionProps) {
  const { session } = useStore();
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const keystoneMode = session?.integrations.keystone ?? 'simulation';
  return (
    <Panel title={t('Keystone integration')} aside={<KeystoneTag mode={keystoneMode} etat={envois?.keystone ?? null} />} style={{ gap: 'var(--space-4)' }}>
      <Field label={t('Level of sharing of the reasons')}>
        <Seg name="param-partage" label={t('Level of sharing of the reasons')} value={s.partageKeystone} disabled={!admin}
          options={[['minimal', t('Reason codes only')], ['detaille', t('Codes and labels of the reasons')]]}
          onChange={v => save({ partageKeystone: v })} />
      </Field>
      <Fine>{t('The Go / No Go verdicts transmitted to Keystone only contain employee numbers and reason codes (HABILITATION, HABILITATION_SUSPENDUE, HABILITATION_RETIREE, CERTIFICATION, DEPLACEMENT, FORMALITES_VOYAGE). In detailed mode, each code comes with an explanatory label; no health data leaves Cursus.')}</Fine>

      <SectionLabel>{t('Incoming calls')}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'calc(-1 * var(--space-2))' }}>
        {KEYSTONE_ENDPOINTS.map(([method, path, desc]) => (
          <div key={path} className="boxed" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
            <Tag cls="tag-neutral" style={{ flex: 'none', ...MONO }}>{method}</Tag>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...MONO, overflowWrap: 'anywhere' }}>{path}</div>
              <div className="text-muted sub">{t(desc)}</div>
            </div>
          </div>
        ))}
      </div>
      <Fine>{t('Prefix ')}<span style={MONO}>/api/integrations/keystone/v1</span>{t(' · authentication by the header ')}<span style={MONO}>X-Api-Key</span>{t(' (key set by the variable ')}<span style={MONO}>KEYSTONE_API_KEY</span>{t(') · OpenAPI specification: ')}<span style={MONO}>/v1/openapi.json</span>{t('. Each call is traced in the log (“Keystone calls” view; the calls without a valid key are summarised in it, one line per minute at most); the routes without ')}<span style={MONO}>/v1</span>{t(' stay served, deprecated.')}</Fine>
      <SectionLabel>{t('Outgoing sends')}</SectionLabel>
      <Fine>
        {keystoneMode === 'api'
          ? t('API mode: the decisions on trip requests, the hours approved on the Keystone projects (neither internal activities, nor CFA classes), the approved absences and the changes of Go / No Go verdict are queued then sent to Keystone one by one, with new attempts in case of error (see “Sends” below).')
          : t('Simulation mode (KEYSTONE_URL not defined): the outgoing messages — decisions on requests, hours approved on the Keystone projects, approved absences, changes of Go / No Go verdict — are traced in the log and marked “simulated”, without being sent. When the sends go live, Keystone will receive the current verdict of each resource followed.')}
      </Fine>
      {keystoneMode === 'api' && envois && (
        <Fine muted={!envois.keystone.enReprise}>
          {envois.keystone.dernierSucces ? `${t('Last send received by Keystone on ')}${quand(envois.keystone.dernierSucces)}` : t('No send received by Keystone for now')}
          {` · ${tn(envois.keystone.nombres.a_envoyer, 'message to send', 'messages to send')} · ${tn(envois.keystone.echecsEnCours, 'failed send', 'failed sends')}`}
          {envois.keystone.nombres.echec > envois.keystone.echecsEnCours && ` · ${tn(envois.keystone.nombres.echec - envois.keystone.echecsEnCours, 'filed failure', 'filed failures')}`}
          {envois.keystone.enReprise && `${t(' · new attempt ')}${envois.keystone.enReprise.prochaine ? `${t('on #le')}${quand(envois.keystone.enReprise.prochaine)}` : t('soon')} (${envois.keystone.enReprise.tentatives}${t(' of 10 already made) — ')}${envois.keystone.enReprise.erreur ?? t('unknown error')}`}
        </Fine>
      )}
    </Panel>
  );
}
