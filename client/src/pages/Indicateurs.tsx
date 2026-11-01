// Écran Indicateurs sociaux (lot 11, chantier C3, t197) : BDESE d'une entreprise de moins de 300 salariés (art. R2312-9,
// rubriques 1° et 2°) et préparation de l'index d'égalité professionnelle. Service RH et lecture seule (droit
// « consultation ») ; ni le manager, ni le référent HSE, ni la paie, ni le CSE (pas d'accès : le service RH imprime ou
// exporte l'arrêté et le dépose dans la BDESE).
// Tout chiffre vient du serveur, déjà masqué au seuil d'anonymat (GET /api/indicateurs, client/src/indicateurs-api.ts) :
// le navigateur ne reçoit ni les natures d'absence médicales, ni le sexe des autres, ni leur date de naissance, et ne fait
// aucune somme ni différence. Une case masquée s'affiche « < k », dans le tableau comme dans le graphique.
// - Onglets (adresse de la page : ?onglet=&annee=&groupe=) : Effectifs, Mouvements, Absentéisme, Formation, Âges et
//   ancienneté, BDESE (N-2, N-1, N ; rubriques 1° et 2° remplies, 3° à 10° listées « hors Cursus »), Égalité (index :
//   indicateurs 1, 2 et 4 hors Cursus), Arrêtés (figer l'année close, l'annuler avec un motif, la mise à disposition du CSE).
// - Une seule période, l'année civile ; groupement par sexe, catégorie, statut, contrat ou équipe.
// - L'année qui a un arrêté en vigueur s'affiche d'après lui (chiffres figés), sauf choix du calcul du jour ; l'équipe,
//   qui change avec les mutations, n'est jamais figée.
// - Graphiques SVG faits maison (components/graphiques/), tableaux accessibles (légende, en-têtes de ligne et de colonne).
// - Imprimer (print.ts : impression signalée au journal, sans valeur) ; Exporter (CSV produit et tracé par le serveur :
//   l'onglet affiché, ou la BDESE entière sur l'onglet BDESE). Chaque année de la BDESE garde son propre seuil d'anonymat.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DownloadSimpleIcon, LockSimpleIcon, PrinterIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { type Case, type GroupeIndicateurs, GROUPES_INDICATEURS, type IndicateursLegaux, type TableauIndicateur } from '../../../shared/rules/indicateurs-legaux.ts';
import type { ArreteIndicateurs } from '../../../shared/types.ts';
import { Barres } from '../components/graphiques/Barres.tsx';
import { texteCase } from '../components/graphiques/commun.ts';
import { Pyramide } from '../components/graphiques/Pyramide.tsx';
import { Btn, Empty, Fine, Kpi, Kpis, NoteAccent, Page, Panel, Seg, Tag } from '../components/ui.tsx';
import { exporterBdese, exporterIndicateurs, lireIndicateurs, requeteIndicateurs, type ReponseIndicateurs, type RequeteIndicateurs } from '../indicateurs-api.ts';
import { printDocument } from '../print.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import {
  aideMasque, type AnneeBdese, arreteEnVigueur, type BlocBdese, caseDe, casesMasquees, colonneAnnee, confirmationAnnuler, confirmationArreter, etatIndex,
  GROUPES_BDESE, MANQUES_BDESE, origine, resumeArrete, rubrique1, rubrique2, RUBRIQUES_HORS_CURSUS, sectionsBdese, sectionsEgalite, sectionsTableaux,
  seuilAnnee, tableauDe, texteMasquees, texteSeuils,
} from './indicateurs-vue.ts';
import { LIBELLE_ONGLET, ONGLETS_INDICATEURS, type OngletIndicateurs, TABLEAUX_ONGLET } from './indicateurs-onglets.ts';

/** Années proposées : les cinq dernières et celles qui ont un arrêté. */
function anneesProposees(courante: number, arretes: readonly ArreteIndicateurs[]): number[] {
  return [...new Set([...Array.from({ length: 5 }, (_, i) => courante - i), ...arretes.map(a => a.annee)])].sort((a, b) => b - a);
}

/**
 * Réponses du serveur pour des requêtes (clé : requeteIndicateurs) ; relues quand l'instantané change de révision (arrêté
 * pris, fiche corrigée). Pendant une relecture, les réponses précédentes restent affichées.
 */
function useReponses(requetes: readonly RequeteIndicateurs[]): Map<string, ReponseIndicateurs | Error> | null {
  const { data } = useStore();
  const espace = data?.user.role ?? 'rh';
  const cle = requetes.map(requeteIndicateurs).join(',');
  const rev = data?.revision;
  const courantes = useRef(requetes);
  courantes.current = requetes;
  const [etat, setEtat] = useState<{ cle: string; r: Map<string, ReponseIndicateurs | Error> } | null>(null);
  useEffect(() => {
    let vivant = true;
    const qs = courantes.current;
    void Promise.all(qs.map(q => lireIndicateurs(q, espace).then(r => r, (e: unknown) => (e instanceof Error ? e : new Error(String(e))))))
      .then(rs => { if (vivant) setEtat({ cle, r: new Map(qs.map((q, i) => [requeteIndicateurs(q), rs[i]])) }); });
    return () => { vivant = false; };
  }, [cle, rev, espace]);
  return etat?.cle === cle ? etat.r : null;
}

/** Cellule d'une case : valeur à la française, ou « < k » expliqué (case masquée). */
function Valeur({ c, seuil, suffixe = '' }: { c: Case | undefined; seuil: number; suffixe?: string }) {
  if (c?.masque) return <abbr className="case-masquee" title={aideMasque(seuil)}>&lt; {seuil}</abbr>;
  return <>{texteCase(c, seuil, suffixe)}</>;
}

/** Tableau accessible d'un indicateur : légende, en-têtes de colonne et de ligne, total en gras. */
function Tableau({ t, seuil, legende = true }: { t: TableauIndicateur; seuil: number; legende?: boolean }) {
  return (
    <div className="scroll-x">
      <table className="table tableau-indicateur">
        <caption className={legende ? undefined : 'sr-only'}>{t.titre}</caption>
        <thead><tr><th scope="col">{t.dimension}</th>{t.colonnes.map(c => <th key={c} scope="col" className="right">{c}</th>)}</tr></thead>
        <tbody>
          {t.lignes.map((l, i) => (
            <tr key={l}>
              <th scope="row" style={{ fontWeight: l === 'Total' ? 600 : 'normal' }}>{l}</th>
              {t.colonnes.map((c, j) => <td key={c} className="right tnum nowrap"><Valeur c={t.cases[i]?.[j]} seuil={seuil} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lignes d'un tableau hors total (graphiques). */
const sansTotal = (t: TableauIndicateur) => t.lignes.map((l, i) => [l, i] as const).filter(([l]) => l !== 'Total');

/** Graphique d'un tableau, quand il en a un : barres par modalité, ou pyramide par sexe ; null sinon. */
function graphique(t: TableauIndicateur, seuil: number): ReactNode {
  const barres = (col: number, suffixe = '') => (
    <Barres titre={`${t.titre} — ${t.colonnes[col]}`} seuil={seuil} suffixe={suffixe} barres={sansTotal(t).map(([l, i]) => ({ libelle: l, c: t.cases[i]?.[col] }))} />
  );
  const groupe = t.lignes.length > 1;
  switch (t.id) {
    case 'effectifs': return groupe ? barres(0) : null;
    case 'mouvements': return groupe ? barres(0) : null;
    case 'sortiesMotifs': case 'entreesContrats': return barres(0);
    case 'absenteisme':
      // Ensemble : les motifs de l'année ; par groupe : le taux de chaque modalité.
      return groupe ? barres(2, ' %')
        : <Barres titre={`${t.titre} par motif`} seuil={seuil} suffixe=" %" barres={t.colonnes.slice(3).map((c, j) => ({ libelle: c.replace(' (%)', ''), c: t.cases[0]?.[j + 3] }))} />;
    case 'absenteismeSante': return barres(0, ' %');
    case 'formation': return groupe ? barres(3, ' %') : null;
    case 'ages': case 'anciennete':
      return <Pyramide titre={t.titre} seuil={seuil} tranches={sansTotal(t).map(([l, i]) => ({ libelle: l, femmes: t.cases[i]?.[0], hommes: t.cases[i]?.[1] }))} />;
    default: return null;
  }
}

/** Panneau d'un tableau : graphique, tableau, définition retenue et complétude. */
function PanneauTableau({ t, seuil }: { t: TableauIndicateur; seuil: number }) {
  const g = graphique(t, seuil);
  return (
    <Panel title={t.titre} style={{ gap: 'var(--space-3)' }}>
      {g != null && <div className="graphes">{g}</div>}
      <Tableau t={t} seuil={seuil} legende={false} />
      <Fine>
        <strong>Définition retenue.</strong> {t.definition}
        {t.completude != null && <>{' '}<strong>Complétude : {t.completude} %</strong>{t.completudeTexte ? ` — ${t.completudeTexte}` : ''}.</>}
      </Fine>
    </Panel>
  );
}

/** Indicateurs clés de l'ensemble (onglet Effectifs). */
function KpisEffectifs({ r }: { r: IndicateursLegaux }) {
  const t = tableauDe(r, 'effectifs');
  if (!t) return null;
  const k = (col: number, kicker: string, sub: string) => <Kpi kicker={kicker} value={<Valeur c={caseDe(t, null, col)} seuil={r.seuil} />} sub={sub} />;
  return (
    <Kpis>
      {k(0, 'Effectif au 31 décembre', 'salariés présents, hors intérimaires')}
      {k(1, 'Effectif moyen', 'Sécurité sociale (art. L130-1 du CSS)')}
      {k(2, 'Équivalents temps plein', 'au dernier jour de la période')}
      {k(3, 'Effectif du Code du travail', 'art. L1111-2 et L1111-3')}
    </Kpis>
  );
}

/** Tableau d'un bloc de la BDESE : lignes × années. */
function TableauBdese({ b, annees }: { b: BlocBdese; annees: readonly AnneeBdese[] }) {
  if (!b.lignes.length) return null;
  return (
    <div className="scroll-x">
      <table className="table tableau-indicateur tableau-bdese">
        <caption>{b.titre}</caption>
        <thead><tr><th scope="col">Indicateur</th>{annees.map(a => <th key={a.annee} scope="col" className="right">{a.annee}{a.arrete ? <span className="sr-only"> (arrêté)</span> : null}</th>)}</tr></thead>
        <tbody>
          {b.lignes.map(l => (
            <tr key={l.libelle}>
              <th scope="row" style={{ fontWeight: 'normal' }}>{l.libelle}</th>
              {l.cases.map((c, i) => <td key={annees[i].annee} className="right tnum nowrap"><Valeur c={c} seuil={annees[i].seuil} suffixe={l.suffixe} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OngletBdese({ annees }: { annees: readonly AnneeBdese[] }) {
  return (<>
    <Panel title="Base de données économiques, sociales et environnementales" style={{ gap: 'var(--space-2)' }}>
      <Fine muted={false}>
        Entreprise de moins de 300 salariés, sans accord sur la BDESE : contenu de l’article R2312-9 du Code du travail, sur les années{' '}
        {annees.map(a => a.annee).join(', ')}. Cursus remplit les rubriques 1° (investissement social) et 2° (égalité professionnelle) avec ce qu’il
        connaît ; le reste est listé avec sa source. Pas de bilan social sous 300 salariés (art. L2312-28).
      </Fine>
      <div className="chips">
        {annees.map(a => <Tag key={a.annee} cls={a.arrete ? 'tag-accent' : 'tag-outline'}>{a.annee} : {a.arrete ? `arrêté n° ${a.arrete}` : 'calcul du jour'}, seuil {a.seuil}</Tag>)}
      </div>
    </Panel>
    <Panel title="1° Investissement social" style={{ gap: 'var(--space-4)' }}>
      {rubrique1(annees).map(b => <TableauBdese key={b.titre} b={b} annees={annees} />)}
    </Panel>
    <Panel title="2° Égalité professionnelle entre les femmes et les hommes" style={{ gap: 'var(--space-4)' }}>
      {rubrique2(annees).map(b => <TableauBdese key={b.titre} b={b} annees={annees} />)}
    </Panel>
    <Panel title="À compléter hors de Cursus" style={{ gap: 'var(--space-3)' }}>
      <div className="scroll-x">
        <table className="table">
          <caption className="sr-only">Indicateurs des rubriques 1° et 2° que Cursus ne fournit pas</caption>
          <thead><tr><th scope="col">Rubrique</th><th scope="col">Indicateur</th><th scope="col">Source</th></tr></thead>
          <tbody>{MANQUES_BDESE.map(m => <tr key={m.quoi}><td className="nowrap">{m.rubrique}</td><th scope="row" style={{ fontWeight: 'normal' }}>{m.quoi}</th><td className="text-muted">{m.source}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="scroll-x">
        <table className="table">
          <caption className="sr-only">Rubriques 3° à 10°, hors de Cursus</caption>
          <thead><tr><th scope="col">Rubrique</th><th scope="col">Thème (hors Cursus)</th><th scope="col">Source</th></tr></thead>
          <tbody>{RUBRIQUES_HORS_CURSUS.map(r => <tr key={r.numero}><td className="nowrap">{r.numero}</td><th scope="row" style={{ fontWeight: 'normal' }}>{r.titre}</th><td className="text-muted">{r.source}</td></tr>)}</tbody>
        </table>
      </div>
      <Fine>Perspectives sur les trois années suivantes : à rédiger par la direction. Un accord d’entreprise peut changer l’organisation et le contenu de la BDESE (art. L2312-21).</Fine>
    </Panel>
  </>);
}

function OngletEgalite({ r }: { r: IndicateursLegaux }) {
  const x = r.index;
  return (<>
    <Kpis>
      <Kpi kicker="Groupes valides" value={`${x.groupesValides} / ${x.groupes}`} sub="catégorie × âge, au moins 3 femmes et 3 hommes" />
      <Kpi kicker="Effectif dans ces groupes" value={x.partGroupesValides == null ? '—' : `${x.partGroupesValides} %`} sub="sous 40 %, l’indicateur 1 n’est pas calculable" />
      <Kpi kicker="Retours de congé de maternité" value={<Valeur c={x.retoursMaternite} seuil={r.seuil} />} sub={`ou d’adoption, terminés en ${x.annee}`} />
    </Kpis>
    <PanneauTableau t={x.effectifs} seuil={r.seuil} />
    <Panel title={`Index d’égalité professionnelle ${x.annee}`} style={{ gap: 'var(--space-3)' }}>
      <NoteAccent>
        Données manquantes : les rémunérations et les augmentations sont dans Sage, aucune n’entre dans Cursus. Les indicateurs 1, 2 et 4 et la note se
        calculent dans Sage ou sur Egapro ; Cursus prépare les effectifs pris en compte et les retours de congé de maternité.
      </NoteAccent>
      <div className="scroll-x">
        <table className="table">
          <caption className="sr-only">Indicateurs de l’index d’égalité professionnelle et leur source</caption>
          <thead><tr><th scope="col">N°</th><th scope="col">Indicateur</th><th scope="col" className="right">Points</th><th scope="col">État</th><th scope="col">Source</th></tr></thead>
          <tbody>
            {x.indicateurs.map(i => (
              <tr key={i.numero}>
                <td>{i.numero}</td>
                <th scope="row" style={{ fontWeight: 'normal' }}>{i.libelle}</th>
                <td className="right tnum">{i.points}</td>
                <td><Tag cls={i.etat === 'hors_cursus' ? 'tag-outline' : 'tag-accent'}>{etatIndex(i.etat)}</Tag></td>
                <td className="text-muted">{i.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Fine>
        Index des entreprises de 50 à 250 salariés (art. L1142-8, D1142-2) : publication au plus tard le 1er mars, déclaration sur Egapro, résultats
        versés à la BDESE. Les groupes de moins de 3 personnes d’un sexe sont exclus de l’indicateur 1. Indicateur 3 : Cursus connaît les retours de
        congé, pas les augmentations.
      </Fine>
    </Panel>
  </>);
}

/** Arrêtés ; `seuil` : le réglage actuel, celui que figera un nouvel arrêté (et non celui d'un arrêté affiché). */
function OngletArretes({ arretes, annee, courante, seuil }: { arretes: readonly ArreteIndicateurs[]; annee: number; courante: number; seuil: number }) {
  const { admin, rh } = useRole();
  const { openDialog, setUi } = useStore();
  // Année proposée à l'arrêté : celle affichée si elle est close, sinon la dernière année close.
  const cible = annee < courante ? annee : courante - 1;
  const enVigueur = arreteEnVigueur(arretes, annee);
  const cibleArretee = arreteEnVigueur(arretes, cible);
  const tries = [...arretes].sort((a, b) => b.annee - a.annee || b.id - a.id);
  return (
    <Panel title="Arrêtés annuels" aside={admin && !cibleArretee
      ? <Btn variant="primary" small icon={<LockSimpleIcon size={14} />} onClick={() => openDialog({ type: 'confirmer', c: confirmationArreter(cible, seuil) })}>Arrêter {cible}</Btn>
      : undefined} style={{ gap: 'var(--space-3)' }}>
      {tries.length === 0 ? <Empty pad="sm">Aucun arrêté : les chiffres affichés sont calculés à chaque consultation.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <caption className="sr-only">Arrêtés annuels des indicateurs sociaux</caption>
            <thead><tr><th scope="col">Année</th><th scope="col">Arrêté</th><th scope="col">État</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {tries.map(a => (
                <tr key={a.id}>
                  <th scope="row" className="tnum">{a.annee}</th>
                  <td><div>n° {a.id}</div><div className="text-muted sub">{resumeArrete(a)}</div>
                    {a.annuleLe && a.annuleMotif && <div className="text-muted sub">Motif : {a.annuleMotif}</div>}</td>
                  <td>{a.annuleLe ? <Tag cls="tag-outline">Annulé</Tag> : a.cseLe ? <Tag cls="tag-accent">Au CSE</Tag> : <Tag cls="tag-neutral">En vigueur</Tag>}</td>
                  <td>
                    <div className="actions-end" style={{ flexWrap: 'wrap' }}>
                      <Btn small onClick={() => setUi({ indAnnee: a.annee, indOnglet: 'bdese' })}>Voir la BDESE</Btn>
                      {rh && !a.annuleLe && <Btn small onClick={() => openDialog({ type: 'arreteCse', id: a.id })}>{a.cseLe ? 'Changer la date du CSE' : 'Mis à disposition du CSE'}</Btn>}
                      {admin && !a.annuleLe && <Btn small onClick={() => openDialog({ type: 'confirmer', c: confirmationAnnuler(a) })}>Annuler</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        L’arrêté fige les agrégats d’une année close, déjà masqués, par groupement (ensemble, sexe, catégorie, statut, contrat ; jamais l’équipe), avec le
        seuil et la version des règles : les purges de conservation (temps 3 ans, dossiers 5 ans) et les corrections ne changent plus les chiffres de N-2
        présentés au CSE. Il n’est jamais supprimé : il s’annule avec un motif (service RH seulement, jamais au journal). Le CSE n’a pas d’accès à Cursus :
        imprimez ou exportez la BDESE, déposez-la, puis notez la date de mise à disposition. {admin ? '' : 'Arrêter ou annuler : administrateur RH.'}
        {enVigueur ? ` ${annee} : arrêté n° ${enVigueur.id} en vigueur.` : annee >= courante ? ` ${annee} n’est pas terminée : elle ne s’arrête qu’à partir du 1er janvier ${annee + 1}.` : ''}
      </Fine>
    </Panel>
  );
}

export function Indicateurs() {
  const d = useDomain();
  const { ui, setUi, notify } = useStore();
  const courante = Number(d.ti.slice(0, 4));
  const annee = ui.indAnnee ?? courante;
  const onglet: OngletIndicateurs = ui.indOnglet;
  // Groupement choisi (mémorisé d'un onglet à l'autre) ; appliqué seulement là où sa liste est visible. BDESE, Égalité et
  // Arrêtés lisent l'ensemble : un groupement caché (l'équipe, jamais figée) ne doit ni passer l'année arrêtée en calcul
  // du jour, ni partir dans un export.
  const avecGroupe = !['bdese', 'egalite', 'arretes'].includes(onglet);
  const groupe: GroupeIndicateurs = avecGroupe ? ui.indGroupe : 'aucun';
  const arretes = useMemo(() => d.ds.indicateursArretes ?? [], [d]);
  const enVigueur = arreteEnVigueur(arretes, annee);
  // Chiffres de l'arrêté en vigueur par défaut ; « Calcul du jour » au choix. L'équipe n'est jamais figée.
  const [calculDuJour, setCalculDuJour] = useState(false);
  const figes = !!enVigueur && !calculDuJour && groupe !== 'equipe';
  const requete: RequeteIndicateurs = figes ? { arrete: enVigueur.id, groupe } : { annee, groupe };
  const anneesBdese = useMemo(() => [annee - 2, annee - 1, annee].map(a => ({ annee: a, arrete: arreteEnVigueur(arretes, a)?.id ?? null })), [annee, arretes]);
  const requetesBdese = useMemo(() => onglet !== 'bdese' ? [] : anneesBdese.flatMap(a => GROUPES_BDESE.map((g): RequeteIndicateurs => (a.arrete ? { arrete: a.arrete, groupe: g } : { annee: a.annee, groupe: g }))),
    [onglet, anneesBdese]);
  const reps = useReponses([requete, ...requetesBdese]);
  const brut = reps?.get(requeteIndicateurs(requete));
  const r = brut instanceof Error ? null : brut ?? null;
  const erreur = brut instanceof Error ? brut.message : null;
  const seuil = r?.seuil ?? d.ds.settings.indicateursSeuil;
  // Chaque année de la BDESE avec son propre seuil : celui de son arrêté, figé avec les agrégats, ou celui du calcul.
  const bdese: AnneeBdese[] = anneesBdese.map(a => {
    const rs: AnneeBdese['r'] = Object.fromEntries(GROUPES_BDESE.map(g => {
      const x = reps?.get(requeteIndicateurs(a.arrete ? { arrete: a.arrete, groupe: g } : { annee: a.annee, groupe: g }));
      return [g, x instanceof Error ? null : x ?? null];
    }));
    return { annee: a.annee, arrete: a.arrete, seuil: seuilAnnee(rs, d.ds.settings.indicateursSeuil), r: rs };
  });
  const seuilTexte = onglet === 'bdese' ? texteSeuils(bdese) : `seuil d’anonymat ${seuil}`;

  // Onglet BDESE : les trois années et les groupements de la BDESE en un fichier (route dédiée) ; ailleurs, l'onglet affiché.
  const exporter = () => {
    (onglet === 'bdese' ? exporterBdese(annee, d.ds.user.role) : exporterIndicateurs(requete, d.ds.user.role)).then(nom => notify(`Export CSV généré — ${nom}`), (e: Error) => notify(e.message, true));
  };
  const imprimer = () => {
    if (!r) return;
    const titre = `Indicateurs sociaux ${annee} — ${LIBELLE_ONGLET[onglet]}`;
    const sections = onglet === 'bdese' ? sectionsBdese(bdese)
      : onglet === 'egalite' ? sectionsEgalite(r)
      : sectionsTableaux((TABLEAUX_ONGLET[onglet] ?? []).map(id => tableauDe(r, id)).filter((t): t is TableauIndicateur => !!t), r.seuil);
    if (!printDocument(titre, onglet === 'bdese' ? `BDESE (art. R2312-9) · ${bdese.map(colonneAnnee).join(' · ')}` : origine(r), sections)) {
      notify('Impression impossible : autorisez les fenêtres surgissantes', true);
    }
  };

  const masquees = r ? casesMasquees(r) : 0;
  let contenu: ReactNode;
  if (onglet === 'arretes') contenu = <OngletArretes arretes={arretes} annee={annee} courante={courante} seuil={d.ds.settings.indicateursSeuil} />;
  else if (erreur) contenu = <Panel><p role="alert" style={{ margin: 0 }}>{erreur}</p></Panel>;
  else if (!r) contenu = <Panel><Empty pad="sm">Calcul des indicateurs…</Empty></Panel>;
  else if (onglet === 'bdese') contenu = <OngletBdese annees={bdese} />;
  else if (onglet === 'egalite') contenu = <OngletEgalite r={r} />;
  else {
    const tableaux = (TABLEAUX_ONGLET[onglet] ?? []).map(id => tableauDe(r, id)).filter((t): t is TableauIndicateur => !!t);
    contenu = <>
      {onglet === 'effectifs' && <KpisEffectifs r={r} />}
      {tableaux.map(t => <PanneauTableau key={t.id} t={t} seuil={r.seuil} />)}
    </>;
  }

  return (
    <Page kicker={`BDESE et égalité professionnelle · année ${annee}${figes ? ` · arrêté n° ${enVigueur.id}` : ''} · ${seuilTexte}`} title="Indicateurs sociaux"
      actions={<>
        <select className="input" aria-label="Année" value={annee} onChange={e => setUi({ indAnnee: Number(e.target.value) === courante ? null : Number(e.target.value) })} style={{ width: 'auto' }}>
          {anneesProposees(courante, arretes).map(a => <option key={a} value={a}>{a}{a === courante ? ' (en cours)' : ''}</option>)}
        </select>
        {avecGroupe && (
          <select className="input" aria-label="Groupement" value={groupe} onChange={e => setUi({ indGroupe: e.target.value as GroupeIndicateurs })} style={{ width: 'auto' }}>
            {(Object.keys(GROUPES_INDICATEURS) as GroupeIndicateurs[]).map(g => <option key={g} value={g}>{g === 'aucun' ? 'Sans groupement' : `Par ${GROUPES_INDICATEURS[g].toLowerCase()}`}</option>)}
          </select>
        )}
        {onglet !== 'arretes' && r && <>
          <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>Exporter (CSV)</Btn>
          <Btn variant="secondary" icon={<PrinterIcon size={14} />} onClick={imprimer}>Imprimer</Btn>
        </>}
      </>}>
      <Seg name="indOnglet" label="Indicateurs affichés" value={onglet} onChange={o => setUi({ indOnglet: o })} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
        options={ONGLETS_INDICATEURS.map(o => [o, LIBELLE_ONGLET[o]])} />
      {enVigueur && onglet !== 'arretes' && onglet !== 'bdese' && (
        <NoteAccent>
          {annee} est arrêtée (arrêté n° {enVigueur.id}, {fmtIso(enVigueur.arreteLe.slice(0, 10))}{enVigueur.cseLe ? `, au CSE le ${fmtIso(enVigueur.cseLe)}` : ''}).{' '}
          {groupe === 'equipe' ? 'Le groupement par équipe n’est pas figé : calcul du jour. ' : ''}
          <Seg name="indSource" label="Chiffres affichés" value={calculDuJour ? 'calcul' : 'arrete'} onChange={v => setCalculDuJour(v === 'calcul')}
            options={[['arrete', 'Chiffres arrêtés'], ['calcul', 'Calcul du jour']]} disabled={groupe === 'equipe'} />
        </NoteAccent>
      )}
      {r && onglet !== 'arretes' && onglet !== 'bdese' && r.avertissements.length > 0 && (
        <Fine>{r.avertissements.join(' · ')}{masquees ? ` · ${texteMasquees(masquees)} « < ${r.seuil} »` : ''}.</Fine>
      )}
      {contenu}
      <Fine>
        Agrégats calculés par le serveur sur l’année civile, jamais de liste nominative. {onglet === 'bdese' && new Set(bdese.map(a => a.seuil)).size > 1
          ? <>« &lt; k » : case qui porte sur moins de k personnes, k étant le seuil de l’année (celui de son arrêté, ou le réglage pour un calcul du jour : {texteSeuils(bdese).replace('seuils d’anonymat : ', '')}), ou</>
          : <>« &lt; {onglet === 'bdese' ? bdese[0].seuil : seuil} » : case qui porte sur moins de {onglet === 'bdese' ? bdese[0].seuil : seuil} personnes, ou</>}
        {' '}qu’un total permettrait de retrouver par différence (seuil d’anonymat, Paramètres → Indicateurs sociaux). Intérimaires sans fiche dans Cursus non
        comptés. {plural(arretes.filter(a => !a.annuleLe).length, 'arrêté en vigueur', 'arrêtés en vigueur')}.
      </Fine>
    </Page>
  );
}
