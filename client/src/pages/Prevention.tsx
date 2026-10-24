// Écran Prévention, compte professionnel de prévention (t052, shared/rules/c2p.ts) : par salarié et par année civile, nuits
// comptées d'après les horaires de poste des feuilles validées (au moins 1 h entre 0 h et 5 h), à part celles des équipes
// successives alternantes, seuils réglementaires au prorata de la période du contrat, facteurs cochés sur le poste occupé.
// Synthèse calculée par le serveur (`Dataset.c2p`) pour le service RH, le référent HSE et la lecture seule ; export CSV
// « à saisir dans la DSN » pour la paie (codes à confirmer), tracé au journal avec son nombre de lignes (downloadCsv).
// Qualifier les horaires et cocher les facteurs : Référentiels, onglets Horaires et Postes.
import { useMemo, useState } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { FACTEURS_C2P } from '../../../shared/constants.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import { ARTICLE_C2P, C2P_SEUIL_ALTERNANT, C2P_SEUIL_NUIT, exportC2p } from '../../../shared/rules/c2p.ts';
import type { LigneC2p } from '../../../shared/types.ts';
import { Btn, Chips, Empty, Fine, Kpi, Kpis, NoteAccent, Page, Panel, Seg, Tag, Two } from '../components/ui.tsx';
import { SuiteListe } from '../components/TriListe.tsx';
import { usePagination } from '../components/tri.ts';
import { downloadCsv } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Seuil affiché : « 120 », « 60,5 » au prorata. */
const seuil = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Nuits comptées et seuil, avec l'étiquette « exposé » au-delà. */
function Compte({ n, s, expose }: { n: number; s: number; expose: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span className="tnum">{n} / {seuil(s)}</span>
      {expose && <Tag cls="tag-accent">Exposé</Tag>}
    </div>
  );
}

/** À signaler sur la ligne : nuits sous un horaire à qualifier, semaines sans horaire, feuilles pas encore validées. */
function signalements(l: LigneC2p): string[] {
  return [
    l.nuitsAQualifier ? `${plural(l.nuitsAQualifier, 'nuit', 'nuits')} sous un horaire à qualifier` : '',
    l.nuitsAQualifier && l.nuitsAlternantes < l.seuilAlternant && l.nuitsAlternantes + l.nuitsAQualifier >= l.seuilAlternant ? 'seuil des équipes alternantes atteint si l’horaire est alternant' : '',
    l.semainesSansHoraire ? `${plural(l.semainesSansHoraire, 'semaine', 'semaines')} sans horaire (aucune nuit comptée)` : '',
    l.feuillesNonValidees ? `${plural(l.feuillesNonValidees, 'feuille', 'feuilles')} pas encore ${l.feuillesNonValidees > 1 ? 'validées' : 'validée'}` : '',
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
  if (!s) return <Page title="Expositions (C2P)"><Empty>Synthèse indisponible pour ce profil.</Empty></Page>;

  const declares = s.lignes.filter(l => l.declarant === 'employeur');
  const compte = (f: string) => declares.filter(l => l.expositions.includes(f as LigneC2p['expositions'][number])).length;
  const exposes = declares.filter(l => l.expositions.length > 0).length;
  const x = exportC2p(d.ds, s);
  const enCours = s.annee === Number(s.arrete.slice(0, 4));
  const sansHoraire = s.lignes.filter(l => l.semainesSansHoraire > 0).length, nonValidees = s.lignes.filter(l => l.feuillesNonValidees > 0).length;

  return (
    <Page kicker={`Compte professionnel de prévention · ${enCours ? `année en cours, au ${fmtIso(s.arrete)}` : `année ${s.annee}`}`} title="Expositions (C2P)"
      actions={<>
        {syntheses.length > 1 && <Seg name="c2pAnnee" label="Année" value={s.annee} onChange={setAnnee} options={syntheses.map(y => [y.annee, String(y.annee)])} />}
        {x.rows.length > 0 && <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={() => downloadCsv(x.fichier, x.head, x.rows)}>Exporter pour la DSN (CSV)</Btn>}
      </>}>
      <Kpis>
        <Kpi kicker="Salariés exposés" value={exposes} sub={`sur ${plural(declares.length, 'salarié déclaré', 'salariés déclarés')} par l’employeur`} />
        <Kpi kicker={FACTEURS_C2P.nuit.label} value={compte('nuit')} sub={`${C2P_SEUIL_NUIT} nuits par an, au prorata`} />
        <Kpi kicker={FACTEURS_C2P.alternant.label} value={compte('alternant')} sub={`${C2P_SEUIL_ALTERNANT} nuits par an, au prorata`} />
        <Kpi kicker="Facteurs du poste" value={declares.filter(l => l.facteursPoste.length > 0).length} sub="répétitif, hyperbare, températures, bruit" />
      </Kpis>

      {s.horairesAQualifier.length > 0 && (
        <NoteAccent>
          {plural(s.horairesAQualifier.length, 'horaire de nuit', 'horaires de nuit')} à qualifier, équipes successives alternantes ou non :{' '}
          {s.horairesAQualifier.join(', ')}. Leurs nuits comptent au travail de nuit (seuil de {C2P_SEUIL_NUIT}) en attendant.{' '}
          <Btn small onClick={() => go('referentiels', { refOnglet: 'horaires' })}>Qualifier les horaires</Btn>
        </NoteAccent>
      )}

      <Panel head={
        <div className="panel-head top">
          <div>
            <h2>Expositions par salarié</h2>
            <div className="text-muted sub">{plural(s.lignes.length, 'salarié sous contrat', 'salariés sous contrat')} en {s.annee}</div>
          </div>
          <Seg name="c2pFiltre" label="Salariés affichés" value={filtre} onChange={setFiltre} options={[['exposes', 'Exposés ou à qualifier'], ['tous', 'Tous']]} />
        </div>
      }>
        {lignes.length === 0 ? <Empty pad="sm">Aucun salarié exposé en {s.annee}, ni de nuit sous un horaire à qualifier.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Collaborateur</th><th>Période</th><th>Travail de nuit</th><th>Équipes alternantes</th><th>Facteurs du poste</th><th>Déclaration</th><th>À vérifier</th></tr></thead>
              <tbody>
                {page.lignes.map(({ l, e }) => {
                  const a = signalements(l);
                  return (
                    <tr key={l.empId}>
                      <td><Two main={e!.nom} sub={[e!.poste, e!.equipe].filter(Boolean).join(' · ')} /></td>
                      <td className="nowrap"><Two main={`${fmtIso(l.du)} – ${fmtIso(l.au)}`} sub={l.prorata < 1 ? `seuils au prorata (${Math.round(l.prorata * 100)} % de l’année)` : undefined} /></td>
                      <td><Compte n={l.nuits} s={l.seuilNuit} expose={l.expositions.includes('nuit')} /></td>
                      <td><Compte n={l.nuitsAlternantes} s={l.seuilAlternant} expose={l.expositions.includes('alternant')} /></td>
                      <td>{l.facteursPoste.length
                        ? <Chips items={l.facteursPoste.map(f => ({ key: f, label: FACTEURS_C2P[f].label, cls: 'tag-neutral' }))} />
                        : <span className="text-muted">Aucun</span>}</td>
                      <td>{l.declarant === 'employeur'
                        ? (l.expositions.length ? <Tag cls="tag-accent">{plural(l.expositions.length, 'facteur', 'facteurs')} à déclarer</Tag> : <span className="text-muted">Rien à déclarer</span>)
                        : l.declarant === 'ett' ? <Two main="Par l’agence d’intérim" sub="expositions à lui transmettre" /> : <Two main="Non déclaré" sub="contrat de moins d’un mois" />}</td>
                      <td>{a.length ? <span className="sub">{a.join(' · ')}</span> : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <SuiteListe p={page} unite={['salarié', 'salariés']} />
        {(sansHoraire > 0 || nonValidees > 0) && (
          <Fine>
            {[sansHoraire ? `${plural(sansHoraire, 'salarié a', 'salariés ont')} des semaines validées sans horaire de poste : aucune nuit n’y est comptée` : '',
              nonValidees ? `${plural(nonValidees, 'salarié a', 'salariés ont')} des feuilles pas encore validées : leurs nuits comptent à la validation` : ''].filter(Boolean).join(' · ')}
            {' '}(colonne « À vérifier », filtre « Tous »).
          </Fine>
        )}
        <Fine>
          Une nuit compte quand le poste comprend au moins 1 h de travail entre 0 h et 5 h ({ARTICLE_C2P}), d’après l’horaire de poste figé sur la feuille
          validée : Cursus ne compte que les nuits issues des horaires de poste, une feuille sans horaire compte sans nuit. Les nuits faites sous un horaire
          qualifié « équipes successives alternantes » (Référentiels → Horaires) comptent au seuil de {C2P_SEUIL_ALTERNANT} nuits, les autres à celui
          de {C2P_SEUIL_NUIT} ; seuils réglementaires, non réglables, au prorata d’un contrat de moins d’un an ; un contrat de moins d’un mois n’est pas
          déclaré. Travail répétitif, milieu hyperbare, températures extrêmes et bruit se cochent sur le poste (Référentiels → Postes) quand ses titulaires
          y sont exposés au-delà du seuil après protections. L’export liste les lignes à saisir dans la DSN de Sage avec les codes internes de Cursus et le
          code DSN présumé, à confirmer par la paie.
        </Fine>
      </Panel>
    </Page>
  );
}
