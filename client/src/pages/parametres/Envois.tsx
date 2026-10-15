// Paramètres → Envois : messages sortants (Keystone, e-mails) filtrés par statut et par cible, détail de chacun,
// relance ou classement d'un envoi en échec (service RH ; la lecture seule consulte). `useSuiviEnvois` charge l'état
// des envois pour toute la page : les sections Keystone et Messagerie en montrent aussi l'état.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArchiveIcon, ArrowClockwiseIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { CIBLE_LABEL, EMAIL_LABEL, ENVOI_CLS, ENVOI_LABEL, EVENEMENT_LABEL, GNG_LABEL } from '../../../../shared/constants.ts';
import { parse } from '../../../../shared/dates.ts';
import { fmt, fmtShort, matricule, num, plural } from '../../../../shared/format.ts';
import type { CibleEnvoi, Courriel, Envoi } from '../../../../shared/types.ts';
import { api, type EnvoisState } from '../../api.ts';
import { Btn, Empty, Fine, Panel, Pre, Seg, Tag, Two, stop } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { type FiltreCible, type FiltreEnvoi, MONO, quand, type SectionProps, type SuiviEnvois } from './commun.ts';

const FILTRES_ENVOI: [FiltreEnvoi, string][] = [['tous', 'Tous'], ['a_envoyer', 'À envoyer'], ['echec', 'En échec'], ['envoye', 'Envoyés'], ['simule', 'Simulés']];
const FILTRES_CIBLE: [FiltreCible, string][] = [['toutes', 'Toutes cibles'], ['keystone', 'Keystone'], ['email', 'E-mails']];

/**
 * Envois sortants : état de l'intégration et derniers messages, relus avec l'instantané (comme le journal) et toutes
 * les 10 s tant que des messages attendent, le temps que le processus de fond les transmette. Droit `consultation`.
 */
export function useSuiviEnvois(consultation: boolean): SuiviEnvois {
  const data = useData();
  const [filtre, setFiltre] = useState<FiltreEnvoi>('tous');
  const [cible, setCible] = useState<FiltreCible>('toutes');
  const [etat, setEtat] = useState<EnvoisState | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const recharger = useCallback(() => {
    let cancelled = false;
    api.envois(filtre === 'tous' ? null : filtre, cible === 'toutes' ? null : cible)
      .then(r => { if (!cancelled) { setEtat(r); setErreur(null); } })
      .catch(err => { if (!cancelled) setErreur((err as Error).message); });
    return () => { cancelled = true; };
  }, [filtre, cible]);
  useEffect(() => (consultation ? recharger() : undefined), [data, consultation, recharger]);
  const enAttente = !!etat?.keystone.nombres.a_envoyer || !!etat?.email?.nombres.a_envoyer;
  useEffect(() => {
    if (!consultation || !enAttente) return;
    const t = setInterval(recharger, 10_000);
    return () => clearInterval(t);
  }, [consultation, enAttente, recharger]);
  return { etat, erreur, filtre, setFiltre, cible, setCible, recharger };
}

/**
 * Personne désignée par un matricule (le RH voit tous les collaborateurs), sinon le matricule seul. Matricule Cursus, ou
 * matricule de paie quand le réglage « identifiant envoyé à Keystone » l'a retenu (messages envoyés depuis).
 */
function useNomMatricule() {
  const data = useData();
  return (m: unknown) => {
    const e = data.employes.find(x => matricule(x.id) === m) ?? data.employes.find(x => !!x.matriculePaie && x.matriculePaie === m);
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

/** Vue « Envois » : relance et classement des échecs réservés au service RH (`rh`), la lecture seule consulte. */
export function Envois({ envois: { etat, erreur: error, filtre, setFiltre, cible, setCible, recharger: reload } }: SectionProps) {
  const { run, session } = useStore();
  const { rh: gerer } = useRole();
  const nom = useNomMatricule();
  const [ouvert, setOuvert] = useState<number | null>(null);
  const modes: Record<CibleEnvoi, string> = {
    keystone: session?.integrations.keystone ?? 'simulation',
    email: etat?.email.mode ?? session?.integrations.email ?? 'simulation',
    sage: session?.integrations.sage ?? 'simulation',
  };
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
                          {e.statut === 'echec' && gerer && (
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
