// Paramètres → Intégration Keystone : niveau de partage des motifs (administrateur RH), routes de l'API entrante,
// état des envois sortants.
import { plural } from '../../../../shared/format.ts';
import type { EnvoisState } from '../../api.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, SectionLabel, Seg, Tag } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { MONO, quand, type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Routes de l'API v1 (préfixe /api/integrations/keystone/v1) ; contrat complet : docs/API-KEYSTONE.md. */
const KEYSTONE_ENDPOINTS: [string, string, string][] = [
  ['PUT', '/projets/:code', 'Projet imputable dans les feuilles de temps'],
  ['PUT', '/chantiers/:id', 'Chantier : dates, exigences du Go / No Go, statut actif ou archivé'],
  ['PUT', '/affectations/:id', 'Présence d’un salarié sur un chantier (mission et ressource du Go / No Go)'],
  ['PUT', '/taches/:id', 'Tâche planifiée : heures prévues par jour, proposées dans la feuille de temps'],
  ['PUT', '/instantane', 'Synchronisation complète : état de référence des projets, chantiers, affectations et tâches'],
  ['GET', '/chantiers/:id/go-no-go', 'Verdict Go / No Go d’un chantier et de ses ressources'],
  ['POST', '/demandes', 'Demande de déplacement d’une ressource, à valider dans Voyages'],
];

/** État réel des envois à Keystone : simulation, échecs en cours (non classés), reprise après erreur, ou à jour. */
function KeystoneTag({ mode, etat }: { mode: string; etat: EnvoisState['keystone'] | null }) {
  if (mode !== 'api') return <Tag cls="tag-outline">Simulation</Tag>;
  if (!etat) return <Tag cls="tag-outline">Mode API</Tag>;
  if (etat.echecsEnCours) return <Tag cls="tag-accent">{plural(etat.echecsEnCours, 'envoi en échec', 'envois en échec')}</Tag>;
  if (etat.enReprise) return <Tag cls="tag-accent">Keystone ne répond pas</Tag>;
  if (etat.nombres.a_envoyer) return <Tag cls="tag-outline">Envoi en cours</Tag>;
  return <Tag cls="tag-neutral">{etat.dernierSucces ? 'API · à jour' : 'API · aucun envoi'}</Tag>;
}

export function Keystone({ s, envois: { etat: envois } }: SectionProps) {
  const { session } = useStore();
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const keystoneMode = session?.integrations.keystone ?? 'simulation';
  return (
    <Panel title="Intégration Keystone" aside={<KeystoneTag mode={keystoneMode} etat={envois?.keystone ?? null} />} style={{ gap: 'var(--space-4)' }}>
      <Field label="Niveau de partage des motifs">
        <Seg name="param-partage" label="Niveau de partage des motifs" value={s.partageKeystone} disabled={!admin}
          options={[['minimal', 'Codes de motifs uniquement'], ['detaille', 'Codes et libellés des motifs']]}
          onChange={v => save({ partageKeystone: v })} />
      </Field>
      <Fine>Les verdicts Go / No Go transmis à Keystone ne contiennent que des matricules et des codes de motif (HABILITATION, HABILITATION_SUSPENDUE, HABILITATION_RETIREE, CERTIFICATION, DEPLACEMENT, FORMALITES_VOYAGE). En mode détaillé, chaque code est accompagné d’un libellé explicatif ; aucune donnée de santé ne sort de Cursus.</Fine>

      <SectionLabel>Appels entrants</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'calc(-1 * var(--space-2))' }}>
        {KEYSTONE_ENDPOINTS.map(([method, path, desc]) => (
          <div key={path} className="boxed" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
            <Tag cls="tag-neutral" style={{ flex: 'none', ...MONO }}>{method}</Tag>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...MONO, overflowWrap: 'anywhere' }}>{path}</div>
              <div className="text-muted sub">{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <Fine>Préfixe <span style={MONO}>/api/integrations/keystone/v1</span> · authentification par l’en-tête <span style={MONO}>X-Api-Key</span> (clé définie par la variable <span style={MONO}>KEYSTONE_API_KEY</span>) · spécification OpenAPI : <span style={MONO}>/v1/openapi.json</span>. Chaque appel est tracé dans le journal (vue « Appels de Keystone » ; les appels sans clé valide y sont résumés, une ligne par minute au plus) ; les routes sans <span style={MONO}>/v1</span> restent servies, obsolètes.</Fine>
      <SectionLabel>Envois sortants</SectionLabel>
      <Fine>
        {keystoneMode === 'api'
          ? 'Mode API : les décisions sur les demandes de déplacement, les heures validées sur les projets Keystone (ni activités internes, ni cours en CFA), les absences validées et les changements de verdict Go / No Go sont mis en file puis envoyés à Keystone un par un, avec de nouvelles tentatives en cas d’erreur (voir « Envois » ci-dessous).'
          : 'Mode simulation (KEYSTONE_URL non définie) : les messages sortants — décisions sur les demandes, heures validées sur les projets Keystone, absences validées, changements de verdict Go / No Go — sont tracés dans le journal et marqués « simulés », sans être envoyés. À la mise en service des envois, Keystone recevra le verdict actuel de chaque ressource suivie.'}
      </Fine>
      {keystoneMode === 'api' && envois && (
        <Fine muted={!envois.keystone.enReprise}>
          {envois.keystone.dernierSucces ? `Dernier envoi reçu par Keystone le ${quand(envois.keystone.dernierSucces)}` : 'Aucun envoi reçu par Keystone pour le moment'}
          {` · ${plural(envois.keystone.nombres.a_envoyer, 'message à envoyer', 'messages à envoyer')} · ${plural(envois.keystone.echecsEnCours, 'envoi en échec', 'envois en échec')}`}
          {envois.keystone.nombres.echec > envois.keystone.echecsEnCours && ` · ${plural(envois.keystone.nombres.echec - envois.keystone.echecsEnCours, 'échec classé', 'échecs classés')}`}
          {envois.keystone.enReprise && ` · nouvelle tentative ${envois.keystone.enReprise.prochaine ? `le ${quand(envois.keystone.enReprise.prochaine)}` : 'bientôt'} (${envois.keystone.enReprise.tentatives} sur 10 déjà faites) — ${envois.keystone.enReprise.erreur ?? 'erreur inconnue'}`}
        </Fine>
      )}
    </Panel>
  );
}
