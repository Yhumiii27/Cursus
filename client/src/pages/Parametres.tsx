// Paramètres (service RH) : règles de suivi, intégrations Keystone et Sage Paie, journal des actions, démonstration.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { parse } from '../../../shared/dates.ts';
import { fmt, plural } from '../../../shared/format.ts';
import type { Settings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, Page, Panel, SectionLabel, Seg, Tag, Two } from '../components/ui.tsx';
import { useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';

type JournalRow = Awaited<ReturnType<typeof api.journal>>[number];

/** Police à chasse fixe pour les codes (pas de classe dédiée dans app.css). */
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

const HORIZONS: [number, string][] = [[30, '30 j'], [60, '60 j'], [90, '90 j'], [120, '120 j'], [150, '150 j'], [180, '180 j']];

const SAGE_RUBRIQUES: [string, string][] = [
  ['HN', 'Heures normales'],
  ['HS25', 'Heures supplémentaires majorées à 25 %'],
  ['HS50', 'Heures supplémentaires majorées à 50 %'],
  ['HC10', 'Heures complémentaires majorées à 10 % (temps partiel)'],
  ['HC25', 'Heures complémentaires majorées à 25 % (temps partiel)'],
  ['RCR_ACQUIS', 'Repos compensateur de remplacement acquis'],
  ['JTRAV', 'Jours travaillés (cadres au forfait jours)'],
];

const KEYSTONE_ENDPOINTS: [string, string, string][] = [
  ['GET', '/api/integrations/keystone/chantiers/:id/go-no-go', 'Verdict Go / No Go d’un chantier et de ses ressources'],
  ['POST', '/api/integrations/keystone/demandes', 'Demande de déplacement d’une ressource, à valider dans Voyages'],
];

const ROLE_LABEL: Record<string, string> = { rh: 'Service RH', manager: 'Manager', collaborateur: 'Collaborateur', integration: 'Intégration' };

function ModeTag({ mode }: { mode: string }) {
  return mode === 'api' ? <Tag cls="tag-neutral">API connectée</Tag> : <Tag cls="tag-outline">Simulation</Tag>;
}

export function Parametres() {
  const data = useData();
  const { session, run, setUi } = useStore();
  const { rh } = useRole();
  const s = data.settings;
  const keystoneMode = session?.integrations.keystone ?? 'simulation';
  const sageMode = session?.integrations.sage ?? 'simulation';

  // Journal : rechargé au montage et à chaque nouvel instantané (donc après chaque action).
  const [journal, setJournal] = useState<JournalRow[] | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  const loadJournal = useCallback(() => {
    let cancelled = false;
    api.journal()
      .then(rows => { if (!cancelled) { setJournal(rows); setJournalError(null); } })
      .catch(err => { if (!cancelled) setJournalError((err as Error).message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => (rh ? loadJournal() : undefined), [data, rh, loadJournal]);

  // Seuil budgétaire : valeur en cours de glissement, enregistrée au relâchement.
  const [seuilDraft, setSeuilDraft] = useState<number | null>(null);
  const seuil = seuilDraft ?? s.seuilBudget;

  const save = async (patch: Partial<Settings>) => {
    const r = await run('parametres.maj', patch);
    if (r.ok && patch.horizonAlerte !== undefined) setUi({ horizon: null });
    return r;
  };
  const savingSeuil = useRef(false);
  const commitSeuil = async () => {
    const value = seuilDraft;
    if (value == null || savingSeuil.current) return;
    savingSeuil.current = true;
    try {
      if (value !== s.seuilBudget) await save({ seuilBudget: value });
    } finally {
      savingSeuil.current = false;
      setSeuilDraft(cur => (cur === value ? null : cur));
    }
  };
  const reset = () => {
    if (window.confirm('Réinitialiser toutes les données de démonstration ? Les modifications effectuées depuis le dernier chargement seront effacées (une sauvegarde de la base est conservée sur le serveur).')) {
      run('demo.reinitialiser');
    }
  };

  if (!rh) return <Page title="Paramètres"><Empty>Paramètres réservés au service RH.</Empty></Page>;

  const push = data.lastSagePush;

  return (
    <Page kicker={`Administration · ${s.rhNom}`} title="Paramètres" note="Ces réglages s’appliquent à tous les utilisateurs de Cursus. Chaque modification est enregistrée immédiatement et tracée dans le journal.">
      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>
          <Panel title="Règles de suivi" style={{ gap: 'var(--space-4)' }}>
            <Field label="Seuil d’alerte par défaut">
              <Seg name="param-horizon" label="Seuil d’alerte par défaut" value={s.horizonAlerte} options={HORIZONS}
                onChange={v => save({ horizonAlerte: v })} style={{ flexWrap: 'wrap' }} />
            </Field>
            <Fine>Une certification, une habilitation ou un document de voyage passe « À renouveler » lorsqu’il expire dans ce délai. Le tableau de bord permet de l’ajuster ponctuellement.</Fine>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={s.uniquementReglementaire} onChange={e => save({ uniquementReglementaire: e.target.checked })}
                style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
              <span>
                Suivre uniquement les formations réglementaires
                <span className="text-muted sub" style={{ display: 'block' }}>Les formations recommandées et internes sortent des statuts de conformité, des échéances et du catalogue proposé aux collaborateurs.</span>
              </span>
            </label>

            <Field label="Seuil de tension budgétaire" htmlFor="param-seuil">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <input id="param-seuil" type="range" min={60} max={100} step={5} value={seuil}
                  onChange={e => setSeuilDraft(Number(e.target.value))} onPointerUp={commitSeuil} onKeyUp={commitSeuil} onBlur={commitSeuil}
                  style={{ flex: 1, maxWidth: 320, accentColor: 'var(--color-accent)' }} />
                <span className="tnum" style={{ fontSize: 14, minWidth: '4ch' }}>{seuil} %</span>
              </div>
            </Field>
            <Fine>Une enveloppe d’équipe est signalée « Tension » lorsque le réalisé et l’engagé atteignent ce pourcentage du budget alloué.</Fine>
          </Panel>

          {session?.demo && (
            <Panel title="Données de démonstration">
              <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                Remet les collaborateurs, formations, feuilles de temps, absences, entretiens, paramètres et le journal dans leur état initial de démonstration. Une sauvegarde de la base actuelle est faite au préalable sur le serveur.
              </p>
              <div>
                <Btn variant="secondary" icon={<ArrowCounterClockwiseIcon size={14} />} onClick={reset}>Réinitialiser les données</Btn>
              </div>
            </Panel>
          )}
        </div>

        <div className="col-stack" style={{ flex: '1 1 380px' }}>
          <Panel title="Intégration Keystone" aside={<ModeTag mode={keystoneMode} />} style={{ gap: 'var(--space-4)' }}>
            <Field label="Niveau de partage des motifs">
              <Seg name="param-partage" label="Niveau de partage des motifs" value={s.partageKeystone}
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
            <Fine>Authentification par l’en-tête <span style={MONO}>X-Api-Key</span> (clé définie par la variable <span style={MONO}>KEYSTONE_API_KEY</span>).</Fine>
            <Fine>
              {keystoneMode === 'api'
                ? 'Mode API : les décisions sur les demandes de déplacement, les heures validées, les absences validées et les verdicts modifiés par une suspension, une levée, un retrait ou une nouvelle délivrance d’habilitation sont envoyés à Keystone.'
                : 'Mode simulation : les messages sortants (décisions sur les demandes, heures et absences validées, verdicts modifiés par une mesure sur une habilitation) sont tracés dans le journal au lieu d’être envoyés.'}
            </Fine>
          </Panel>

          <Panel title="Sage Paie" aside={<ModeTag mode={sageMode} />}>
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              {sageMode === 'api'
                ? 'Mode API : les variables de paie des feuilles de temps validées sont envoyées à Sage Paie depuis l’écran Feuilles de temps.'
                : 'Mode simulation : la transmission depuis l’écran Feuilles de temps renvoie un accusé de réception fictif.'}
              {' '}Intérimaires exclus (relevé envoyé à l’agence).
            </p>
            <SectionLabel>Rubriques transmises</SectionLabel>
            <table className="table">
              <thead><tr><th>Rubrique</th><th>Contenu</th></tr></thead>
              <tbody>
                {SAGE_RUBRIQUES.map(([code, label]) => (
                  <tr key={code}><td className="nowrap" style={MONO}>{code}</td><td className="text-muted" style={{ fontSize: 13 }}>{label}</td></tr>
                ))}
              </tbody>
            </table>
            <Fine>Correspondance avec le plan de paie Sage à paramétrer.</Fine>
            <Fine>
              {push
                ? `Dernier envoi le ${fmt(parse(push.envoye_le.slice(0, 10)))} · période ${push.periode_paie} · ${plural(push.lignes.length, 'ligne', 'lignes')} · dossier ${push.dossier}`
                : 'Aucune transmission effectuée pour le moment.'}
            </Fine>
          </Panel>
        </div>
      </div>

      <Panel title="Journal des actions" aside={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="text-muted sub">100 dernières actions</span>
          <Btn small onClick={() => loadJournal()}>Actualiser</Btn>
        </div>
      }>
        {journalError && <p className="form-error">{journalError}</p>}
        {journal == null && !journalError && <Empty pad="sm">Chargement du journal…</Empty>}
        {journal != null && journal.length === 0 && <Empty pad="sm">Aucune action enregistrée.</Empty>}
        {journal != null && journal.length > 0 && (
          <div className="scroll-x" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Date / heure</th><th>Auteur</th><th>Action</th><th>Message</th></tr></thead>
              <tbody>
                {journal.map((j, i) => {
                  const at = new Date(j.at);
                  return (
                    <tr key={`${j.at}-${i}`}>
                      <td><Two main={fmt(at)} sub={at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} nowrap /></td>
                      <td><Two main={j.actor} sub={ROLE_LABEL[j.role] ?? j.role} nowrap /></td>
                      <td className="nowrap text-n300" style={MONO}>{j.action}</td>
                      <td className="text-muted" style={{ fontSize: 13 }}>{j.message ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}
