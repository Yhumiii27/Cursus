// Paramètres (service RH) : règles de suivi, intégrations Keystone et Sage Paie, envois sortants, comptes et accès,
// journal des actions, démonstration. Les réglages, les comptes et la réinitialisation sont réservés à l'administrateur RH ;
// le gestionnaire RH consulte.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveIcon, ArrowClockwiseIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { CIBLE_LABEL, EMAIL_LABEL, ENVOI_CLS, ENVOI_LABEL, EVENEMENT_LABEL, GNG_LABEL } from '../../../shared/constants.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, fmtShort, matricule, num, plural } from '../../../shared/format.ts';
import type { CibleEnvoi, Courriel, Envoi, Settings, StatutEnvoi } from '../../../shared/types.ts';
import { api, type EnvoisState, type FiltreJournal } from '../api.ts';
import { Field } from '../components/Dialog.tsx';
import { Btn, Empty, Fine, Page, Panel, Pre, SectionLabel, Seg, Tag, Two, stop } from '../components/ui.tsx';
import { useRole } from '../state/derived.ts';
import { useData, useStore } from '../state/store.tsx';
import { ComptesPanel } from './Comptes.tsx';
import { MessageriePanel } from './Messagerie.tsx';

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

const ROLE_LABEL: Record<string, string> = { rh: 'Service RH', manager: 'Manager', collaborateur: 'Collaborateur', integration: 'Intégration' };

function ModeTag({ mode }: { mode: string }) {
  return mode === 'api' ? <Tag cls="tag-neutral">API connectée</Tag> : <Tag cls="tag-outline">Simulation</Tag>;
}

/** Date et heure locales d'un horodatage ISO : « 10 oct. 2026 à 09:12 ». */
const quand = (at: string) => {
  const d = new Date(at);
  return `${fmt(d)} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** État réel des envois à Keystone : simulation, échecs en cours (non classés), reprise après erreur, ou à jour. */
function KeystoneTag({ mode, etat }: { mode: string; etat: EnvoisState['keystone'] | null }) {
  if (mode !== 'api') return <Tag cls="tag-outline">Simulation</Tag>;
  if (!etat) return <Tag cls="tag-outline">Mode API</Tag>;
  if (etat.echecsEnCours) return <Tag cls="tag-accent">{plural(etat.echecsEnCours, 'envoi en échec', 'envois en échec')}</Tag>;
  if (etat.enReprise) return <Tag cls="tag-accent">Keystone ne répond pas</Tag>;
  if (etat.nombres.a_envoyer) return <Tag cls="tag-outline">Envoi en cours</Tag>;
  return <Tag cls="tag-neutral">{etat.dernierSucces ? 'API · à jour' : 'API · aucun envoi'}</Tag>;
}


type FiltreEnvoi = StatutEnvoi | 'tous';
const FILTRES_ENVOI: [FiltreEnvoi, string][] = [['tous', 'Tous'], ['a_envoyer', 'À envoyer'], ['echec', 'En échec'], ['envoye', 'Envoyés'], ['simule', 'Simulés']];
type FiltreCible = CibleEnvoi | 'toutes';
const FILTRES_CIBLE: [FiltreCible, string][] = [['toutes', 'Toutes cibles'], ['keystone', 'Keystone'], ['email', 'E-mails']];

export function Parametres() {
  const data = useData();
  const { session, run, setUi } = useStore();
  const { rh, admin, user } = useRole();
  const s = data.settings;
  const keystoneMode = session?.integrations.keystone ?? 'simulation';
  const sageMode = session?.integrations.sage ?? 'simulation';

  // Envois sortants : état de l'intégration et derniers messages, rechargés comme le journal.
  const [filtre, setFiltre] = useState<FiltreEnvoi>('tous');
  const [cible, setCible] = useState<FiltreCible>('toutes');
  const [envois, setEnvois] = useState<EnvoisState | null>(null);
  const [envoisError, setEnvoisError] = useState<string | null>(null);
  const loadEnvois = useCallback(() => {
    let cancelled = false;
    api.envois(filtre === 'tous' ? null : filtre, cible === 'toutes' ? null : cible)
      .then(r => { if (!cancelled) { setEnvois(r); setEnvoisError(null); } })
      .catch(err => { if (!cancelled) setEnvoisError((err as Error).message); });
    return () => { cancelled = true; };
  }, [filtre, cible]);
  useEffect(() => (rh ? loadEnvois() : undefined), [data, rh, loadEnvois]);
  // Messages en attente : l'état est relu toutes les 10 s, le temps que le processus de fond les transmette.
  const enAttente = !!envois?.keystone.nombres.a_envoyer || !!envois?.email?.nombres.a_envoyer;
  useEffect(() => {
    if (!rh || !enAttente) return;
    const t = setInterval(loadEnvois, 10_000);
    return () => clearInterval(t);
  }, [rh, enAttente, loadEnvois]);

  // Journal : rechargé au montage, à chaque nouvel instantané (donc après chaque action) et au changement de filtre.
  // Les appels entrants de Keystone, nombreux, ont leur propre filtre pour ne pas masquer les actions.
  const [journal, setJournal] = useState<JournalRow[] | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [journalFiltre, setJournalFiltre] = useState<FiltreJournal>('tout');
  const loadJournal = useCallback(() => {
    let cancelled = false;
    api.journal(journalFiltre)
      .then(rows => { if (!cancelled) { setJournal(rows); setJournalError(null); } })
      .catch(err => { if (!cancelled) setJournalError((err as Error).message); });
    return () => { cancelled = true; };
  }, [journalFiltre]);
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
    <Page kicker={`Administration · ${user.nom}`} title="Paramètres" note={admin
      ? 'Ces réglages s’appliquent à tous les utilisateurs de Cursus. Chaque modification est enregistrée immédiatement et tracée dans le journal.'
      : 'Consultation : les réglages, les comptes et la transmission à la paie sont réservés à l’administrateur RH.'}>
      <div className="row-wrap">
        <div className="col-stack" style={{ flex: '1 1 480px' }}>
          <Panel title="Règles de suivi" style={{ gap: 'var(--space-4)' }}>
            <Field label="Seuil d’alerte par défaut">
              <Seg name="param-horizon" label="Seuil d’alerte par défaut" value={s.horizonAlerte} options={HORIZONS} disabled={!admin}
                onChange={v => save({ horizonAlerte: v })} style={{ flexWrap: 'wrap' }} />
            </Field>
            <Fine>Une certification, une habilitation ou un document de voyage passe « À renouveler » lorsqu’il expire dans ce délai. Le tableau de bord permet de l’ajuster ponctuellement.</Fine>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={s.uniquementReglementaire} disabled={!admin} onChange={e => save({ uniquementReglementaire: e.target.checked })}
                style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
              <span>
                Suivre uniquement les formations réglementaires
                <span className="text-muted sub" style={{ display: 'block' }}>Les formations recommandées et internes sortent des statuts de conformité, des échéances et du catalogue proposé aux collaborateurs.</span>
              </span>
            </label>

            <Field label="Seuil de tension budgétaire" htmlFor="param-seuil">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <input id="param-seuil" type="range" min={60} max={100} step={5} value={seuil} disabled={!admin}
                  onChange={e => setSeuilDraft(Number(e.target.value))} onPointerUp={commitSeuil} onKeyUp={commitSeuil} onBlur={commitSeuil}
                  style={{ flex: 1, maxWidth: 320, accentColor: 'var(--color-accent)' }} />
                <span className="tnum" style={{ fontSize: 14, minWidth: '4ch' }}>{seuil} %</span>
              </div>
            </Field>
            <Fine>Une enveloppe d’équipe est signalée « Tension » lorsque le réalisé et l’engagé atteignent ce pourcentage du budget alloué.</Fine>
          </Panel>

          {session?.demo && admin && (
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

      <MessageriePanel etat={envois?.email ?? null} reload={loadEnvois} />

      <EnvoisPanel etat={envois} error={envoisError} filtre={filtre} setFiltre={setFiltre} cible={cible} setCible={setCible} reload={loadEnvois}
        modes={{ keystone: keystoneMode, email: envois?.email.mode ?? session?.integrations.email ?? 'simulation', sage: sageMode }} />

      {admin && <ComptesPanel />}

      <Panel title="Journal des actions" aside={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Seg name="journal-filtre" label="Lignes du journal" value={journalFiltre} onChange={setJournalFiltre}
            options={[['tout', 'Tout'], ['operations', 'Opérations'], ['connexions', 'Connexions'], ['keystone', 'Appels de Keystone']]} />
          <span className="text-muted sub">100 dernières lignes</span>
          <Btn small onClick={() => loadJournal()}>Actualiser</Btn>
        </div>
      }>
        {journalError && <p className="form-error">{journalError}</p>}
        {journal == null && !journalError && <Empty pad="sm">Chargement du journal…</Empty>}
        {journal != null && journal.length === 0 && <Empty pad="sm">{journalFiltre === 'connexions' ? 'Aucune connexion enregistrée.' : journalFiltre === 'keystone' ? 'Aucun appel de Keystone enregistré.' : 'Aucune action enregistrée.'}</Empty>}
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
                      <td><Two main={j.actor} sub={[j.role && (ROLE_LABEL[j.role] ?? j.role), j.identifiant].filter(Boolean).join(' · ')} nowrap /></td>
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

/** Personne désignée par un matricule (le RH voit tous les collaborateurs), sinon le matricule seul. */
function useNomMatricule() {
  const data = useData();
  return (m: unknown) => {
    const e = data.employes.find(x => matricule(x.id) === m);
    return e ? `${e.nom} (${String(m)})` : String(m ?? '—');
  };
}

const GNG_TEXTE: Record<string, string> = { GO: GNG_LABEL.go, GO_RESERVE: GNG_LABEL.reserve, NO_GO: GNG_LABEL.nogo };

/** Résumé d'un message, lisible par le RH : noms à la place des matricules, codes de motif conservés ; e-mail : destinataires et objet. */
function resumeEnvoi(e: Envoi, nom: (m: unknown) => string): string {
  if (e.cible === 'email') {
    const m = e.contenu as unknown as Courriel;
    return `À ${(m.a ?? []).join(', ')} · ${m.objet}${m.pj?.length ? ` · ${plural(m.pj.length, 'pièce jointe', 'pièces jointes')}` : ''}`;
  }
  const c = e.contenu as Record<string, any>;
  const jour = (v: unknown) => (typeof v === 'string' ? fmtShort(parse(v)) : '—');
  const gng = (v: unknown) => GNG_TEXTE[String(v)] ?? String(v);
  switch (e.type) {
    case 'demande.decision':
      return `${c.decision === 'acceptee' ? 'Acceptée' : 'Refusée'} · ${c.reference ?? `demande n° ${c.demande}`} · ${nom(c.matricule)} · chantier ${c.chantier}`;
    case 'heures.validees':
      return `${nom(c.matricule)} · semaine du ${jour(c.semaine)} · ${Object.entries(c.projets ?? {}).map(([p, h]) => `${p} : ${String(num(h)).replace('.', ',')} h`).join(', ')}`;
    case 'absence.validee':
    case 'absence.annulee':
      return `${nom(c.matricule)} · du ${jour(c.du)} au ${jour(c.au)}`;
    case 'verdict.modifie': {
      const r = c.ressource ?? {};
      const motifs = (r.motifs ?? []).map((m: { code: string }) => m.code).join(', ');
      return `Chantier ${c.chantier} · ${nom(r.matricule)} : ${r.precedent ? `${gng(r.precedent)} → ` : ''}${gng(r.statut)}${motifs ? ` (${motifs})` : ''}`;
    }
    default:
      return '';
  }
}

/** Suivi d'un message dans la liste : accusé, erreur ou prochaine tentative. */
function suiviEnvoi(e: Envoi): string {
  if (e.statut === 'envoye') return `Reçu le ${quand(e.envoi!)} · accusé ${e.accuse ?? '—'}`;
  if (e.statut === 'simule') return 'Tracé dans le journal (simulation)';
  if (e.statut === 'echec') return `Échec après ${plural(e.tentatives, 'tentative', 'tentatives')}${e.classe ? ` · classé le ${quand(e.classe)}` : ''} — ${e.erreur ?? 'erreur inconnue'}`;
  if (!e.tentatives) return 'En file, envoi dans quelques secondes';
  return `Tentative ${e.tentatives + 1} le ${quand(e.prochaine!)} — ${e.erreur ?? 'erreur inconnue'}`;
}

/** Contenu d'un e-mail tel qu'il part : en-têtes, texte, pièces jointes (nom et type). */
function DetailEmail({ e }: { e: Envoi }) {
  const m = e.contenu as unknown as Courriel;
  const entetes = [`À : ${(m.a ?? []).join(', ')}`, ...(m.repondreA ? [`Réponse à : ${m.repondreA}`] : []), `Objet : ${m.objet}`];
  const pj = (m.pj ?? []).map(p => `${p.nom} (${p.type.split(';')[0]})`).join(', ');
  // Texte replié à la largeur du panneau, comme dans une messagerie.
  return <pre className="pre" style={{ maxHeight: 320, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{`${entetes.join('\n')}${pj ? `\nPièces jointes : ${pj}` : ''}\n\n${m.texte}`}</pre>;
}

/** Vue « Envois » : messages sortants filtrés par statut et par cible, détail de chacun, relance ou classement d'un envoi en échec. */
function EnvoisPanel({ etat, error, filtre, setFiltre, cible, setCible, reload, modes }: {
  etat: EnvoisState | null; error: string | null; filtre: FiltreEnvoi; setFiltre: (f: FiltreEnvoi) => void;
  cible: FiltreCible; setCible: (c: FiltreCible) => void; reload: () => void; modes: Record<CibleEnvoi, string>;
}) {
  const { run } = useStore();
  const nom = useNomMatricule();
  const [ouvert, setOuvert] = useState<number | null>(null);
  const liste = etat?.envois ?? null;
  const relancer = async (id: number) => {
    const r = await run('envoi.relancer', { id });
    if (r.ok) reload();
  };
  const classer = async (id: number) => {
    const r = await run('envoi.classer', { id });
    if (r.ok) reload();
  };

  return (
    <Panel title="Envois" aside={
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Seg name="envois-cible" label="Destinataire des envois" value={cible} options={FILTRES_CIBLE} onChange={setCible} style={{ flexWrap: 'wrap' }} />
        <Seg name="envois-filtre" label="Statut des envois" value={filtre} options={FILTRES_ENVOI} onChange={setFiltre} style={{ flexWrap: 'wrap' }} />
        <Btn small icon={<ArrowClockwiseIcon size={14} />} onClick={() => reload()}>Actualiser</Btn>
      </div>
    }>
      <Fine>Messages envoyés à Keystone et e-mails envoyés par Microsoft 365, 100 plus récents. Un message Keystone garde sa clé d’idempotence d’une tentative à l’autre : Keystone écarte un message déjà reçu. Après une erreur réseau, un délai dépassé (10 s) ou une erreur 5xx, 408 ou 429, l’envoi est retenté de 1 min à 1 h plus tard, 10 fois au plus, et les messages suivants de la même cible attendent leur tour ; une autre erreur (4xx) le met aussitôt en échec.</Fine>
      {error && <p className="form-error">{error}</p>}
      {liste == null && !error && <Empty pad="sm">Chargement des envois…</Empty>}
      {liste != null && liste.length === 0 && <Empty pad="sm">{filtre === 'tous' ? 'Aucun message sortant pour le moment.' : 'Aucun envoi avec ce statut.'}</Empty>}
      {liste != null && liste.length > 0 && (
        <div className="scroll-x" style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>Mis en file</th><th>Message</th><th>Statut</th><th>Suivi</th></tr></thead>
            <tbody>
              {liste.map(e => (
                <Fragment key={e.id}>
                  <tr className={`clickable${ouvert === e.id ? ' selected' : ''}`} onClick={() => setOuvert(ouvert === e.id ? null : e.id)} aria-expanded={ouvert === e.id}>
                    <td><Two nowrap main={fmt(new Date(e.creation))} sub={new Date(e.creation).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} /></td>
                    <td><Two main={`${CIBLE_LABEL[e.cible] ?? e.cible} · ${(e.cible === 'email' ? EMAIL_LABEL[e.type] : EVENEMENT_LABEL[e.type]) ?? e.type}`} sub={resumeEnvoi(e, nom)} /></td>
                    <td><Tag cls={ENVOI_CLS[e.statut]}>{ENVOI_LABEL[e.statut]}</Tag></td>
                    <td className="text-muted" style={{ fontSize: 13 }}>{suiviEnvoi(e)}</td>
                  </tr>
                  {ouvert === e.id && (
                    <tr>
                      <td colSpan={4}>
                        <div className="col-stack" style={{ gap: 'var(--space-3)' }}>
                          <div className="text-muted sub">
                            {`Type ${e.type}`}
                            {/* La clé d'idempotence ne sert qu'aux destinataires qui la contrôlent (Keystone). */}
                            {e.cible !== 'email' && <>{' · clé d’idempotence '}<span style={{ ...MONO, overflowWrap: 'anywhere' }}>{e.cle}</span></>}
                            {` · ${plural(e.tentatives, 'tentative', 'tentatives')}`}
                            {e.tentative && ` · dernière le ${quand(e.tentative)}`}
                            {e.envoi && ` · reçu le ${quand(e.envoi)}`}
                          </div>
                          {e.erreur && <div className={e.statut === 'envoye' ? 'sub text-n400' : 'note-accent'}>{e.statut === 'envoye' ? 'Erreur avant réussite : ' : 'Dernière erreur : '}{e.erreur}</div>}
                          {e.accuse && <div className="sub">Accusé de réception : <span style={MONO}>{e.accuse}</span></div>}
                          {e.cible === 'email' ? <DetailEmail e={e} /> : <Pre maxHeight={240}>{JSON.stringify(e.contenu, null, 2)}</Pre>}
                          {e.statut === 'echec' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                              <Btn variant="secondary" small icon={<ArrowCounterClockwiseIcon size={14} />} disabled={modes[e.cible] !== 'api'} onClick={stop(() => relancer(e.id))}>Relancer</Btn>
                              {!e.classe && <Btn small icon={<ArchiveIcon size={14} />} onClick={stop(() => classer(e.id))}>Classer</Btn>}
                              <span className="text-muted sub">
                                {modes[e.cible] === 'api' ? 'Relancer : nouvelle série de 10 tentatives, même contenu et même clé.' : `Relance impossible en simulation (${e.cible === 'email' ? 'CURSUS_MAIL_FROM' : 'KEYSTONE_URL'} non définie).`}
                                {!e.classe && ' Classer : échec examiné (refus que la relance ne corrigera pas), retiré des échecs en cours, gardé dans la liste.'}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
