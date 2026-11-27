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
import { fmtIso } from '../../../shared/format.ts';
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
import { t, tn } from '../i18n/langue.ts';

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
function Tableau({ tb, seuil, legende = true }: { tb: TableauIndicateur; seuil: number; legende?: boolean }) {
  return (
    <div className="scroll-x">
      <table className="table tableau-indicateur">
        <caption className={legende ? undefined : 'sr-only'}>{tb.titre}</caption>
        <thead><tr><th scope="col">{tb.dimension}</th>{tb.colonnes.map(c => <th key={c} scope="col" className="right">{c}</th>)}</tr></thead>
        <tbody>
          {tb.lignes.map((l, i) => (
            <tr key={l}>
              <th scope="row" style={{ fontWeight: l === 'Total' ? 600 : 'normal' }}>{l}</th>
              {tb.colonnes.map((c, j) => <td key={c} className="right tnum nowrap"><Valeur c={tb.cases[i]?.[j]} seuil={seuil} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lignes d'un tableau hors total (graphiques). */
const sansTotal = (tb: TableauIndicateur) => tb.lignes.map((l, i) => [l, i] as const).filter(([l]) => l !== 'Total');

/** Graphique d'un tableau, quand il en a un : barres par modalité, ou pyramide par sexe ; null sinon. */
function graphique(tb: TableauIndicateur, seuil: number): ReactNode {
  const barres = (col: number, suffixe = '') => (
    <Barres titre={`${tb.titre} — ${tb.colonnes[col]}`} seuil={seuil} suffixe={suffixe} barres={sansTotal(tb).map(([l, i]) => ({ libelle: l, c: tb.cases[i]?.[col] }))} />
  );
  const groupe = tb.lignes.length > 1;
  switch (tb.id) {
    case 'effectifs': return groupe ? barres(0) : null;
    case 'mouvements': return groupe ? barres(0) : null;
    case 'sortiesMotifs': case 'entreesContrats': return barres(0);
    case 'absenteisme':
      // Ensemble : les motifs de l'année ; par groupe : le taux de chaque modalité.
      return groupe ? barres(2, ' %')
        : <Barres titre={`${tb.titre}${t(' by reason')}`} seuil={seuil} suffixe=" %" barres={tb.colonnes.slice(3).map((c, j) => ({ libelle: c.replace(' (%)', ''), c: tb.cases[0]?.[j + 3] }))} />;
    case 'absenteismeSante': return barres(0, ' %');
    case 'formation': return groupe ? barres(3, ' %') : null;
    case 'ages': case 'anciennete':
      return <Pyramide titre={tb.titre} seuil={seuil} tranches={sansTotal(tb).map(([l, i]) => ({ libelle: l, femmes: tb.cases[i]?.[0], hommes: tb.cases[i]?.[1] }))} />;
    default: return null;
  }
}

/** Panneau d'un tableau : graphique, tableau, définition retenue et complétude. */
function PanneauTableau({ tb, seuil }: { tb: TableauIndicateur; seuil: number }) {
  const g = graphique(tb, seuil);
  return (
    <Panel title={tb.titre} style={{ gap: 'var(--space-3)' }}>
      {g != null && <div className="graphes">{g}</div>}
      <Tableau tb={tb} seuil={seuil} legende={false} />
      <Fine>
        <strong>{t('Definition used.')}</strong> {tb.definition}
        {tb.completude != null && <>{' '}<strong>{t('Completeness: ')}{tb.completude} %</strong>{tb.completudeTexte ? ` — ${tb.completudeTexte}` : ''}.</>}
      </Fine>
    </Panel>
  );
}

/** Indicateurs clés de l'ensemble (onglet Effectifs). */
function KpisEffectifs({ r }: { r: IndicateursLegaux }) {
  const tb = tableauDe(r, 'effectifs');
  if (!tb) return null;
  const k = (col: number, kicker: string, sub: string) => <Kpi kicker={kicker} value={<Valeur c={caseDe(tb, null, col)} seuil={r.seuil} />} sub={sub} />;
  return (
    <Kpis>
      {k(0, t('Headcount at 31 December'), t('employees present, excluding temporary workers'))}
      {k(1, t('Average headcount'), t('Social security (art. L130-1 of the CSS)'))}
      {k(2, t('Full-time equivalents'), t('on the last day of the period'))}
      {k(3, t('Headcount under the Labour Code'), t('art. L1111-2 and L1111-3'))}
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
        <thead><tr><th scope="col">{t('Indicator')}</th>{annees.map(a => <th key={a.annee} scope="col" className="right">{a.annee}{a.arrete ? <span className="sr-only">{t(' (frozen)')}</span> : null}</th>)}</tr></thead>
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
    <Panel title={t('Economic, social and environmental database')} style={{ gap: 'var(--space-2)' }}>
      <Fine muted={false}>
        {t('Company of fewer than 300 employees, without an agreement on the BDESE: content of article R2312-9 of the Labour Code, over the years')}{' '}
        {annees.map(a => a.annee).join(', ')}{t('. Cursus fills headings 1° (social investment) and 2° (gender equality at work) with what it knows; the rest is listed with its source. No social report under 300 employees (art. L2312-28).')}
      </Fine>
      <div className="chips">
        {annees.map(a => <Tag key={a.annee} cls={a.arrete ? 'tag-accent' : 'tag-outline'}>{a.annee}{t(': ')}{a.arrete ? `${t('freeze no. ')}${a.arrete}` : t('calculation of the day')}{t(', threshold ')}{a.seuil}</Tag>)}
      </div>
    </Panel>
    <Panel title={t('1° Social investment')} style={{ gap: 'var(--space-4)' }}>
      {rubrique1(annees).map(b => <TableauBdese key={b.titre} b={b} annees={annees} />)}
    </Panel>
    <Panel title={t('2° Gender equality at work between women and men')} style={{ gap: 'var(--space-4)' }}>
      {rubrique2(annees).map(b => <TableauBdese key={b.titre} b={b} annees={annees} />)}
    </Panel>
    <Panel title={t('To complete outside Cursus')} style={{ gap: 'var(--space-3)' }}>
      <div className="scroll-x">
        <table className="table">
          <caption className="sr-only">{t('Indicators of headings 1° and 2° that Cursus does not provide')}</caption>
          <thead><tr><th scope="col">{t('Heading')}</th><th scope="col">{t('Indicator')}</th><th scope="col">{t('Source')}</th></tr></thead>
          <tbody>{MANQUES_BDESE.map(m => <tr key={m.quoi}><td className="nowrap">{t(m.rubrique)}</td><th scope="row" style={{ fontWeight: 'normal' }}>{t(m.quoi)}</th><td className="text-muted">{t(m.source)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="scroll-x">
        <table className="table">
          <caption className="sr-only">{t('Headings 3° to 10°, outside Cursus')}</caption>
          <thead><tr><th scope="col">{t('Heading')}</th><th scope="col">{t('Theme (outside Cursus)')}</th><th scope="col">{t('Source')}</th></tr></thead>
          <tbody>{RUBRIQUES_HORS_CURSUS.map(r => <tr key={r.numero}><td className="nowrap">{r.numero}</td><th scope="row" style={{ fontWeight: 'normal' }}>{t(r.titre)}</th><td className="text-muted">{t(r.source)}</td></tr>)}</tbody>
        </table>
      </div>
      <Fine>{t('Outlook over the next three years: to be written by the management. A company agreement can change the organisation and the content of the BDESE (art. L2312-21).')}</Fine>
    </Panel>
  </>);
}

function OngletEgalite({ r }: { r: IndicateursLegaux }) {
  const x = r.index;
  return (<>
    <Kpis>
      <Kpi kicker={t('Valid groups')} value={`${x.groupesValides} / ${x.groupes}`} sub={t('category × age, at least 3 women and 3 men')} />
      <Kpi kicker={t('Headcount in these groups')} value={x.partGroupesValides == null ? '—' : `${x.partGroupesValides} %`} sub={t('under 40 %, indicator 1 cannot be calculated')} />
      <Kpi kicker={t('Returns from maternity leave')} value={<Valeur c={x.retoursMaternite} seuil={r.seuil} />} sub={`${t('or adoption leave, ended in ')}${x.annee}`} />
    </Kpis>
    <PanneauTableau tb={x.effectifs} seuil={r.seuil} />
    <Panel title={`${t('Gender equality index ')}${x.annee}`} style={{ gap: 'var(--space-3)' }}>
      <NoteAccent>
        {t('Missing data: pay and pay rises are in Sage, none enters Cursus. Indicators 1, 2 and 4 and the score are calculated in Sage or on Egapro; Cursus prepares the headcounts taken into account and the returns from maternity leave.')}
      </NoteAccent>
      <div className="scroll-x">
        <table className="table">
          <caption className="sr-only">{t('Indicators of the gender equality index and their source')}</caption>
          <thead><tr><th scope="col">{t('No.')}</th><th scope="col">{t('Indicator')}</th><th scope="col" className="right">{t('Points')}</th><th scope="col">{t('State')}</th><th scope="col">{t('Source')}</th></tr></thead>
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
        {t('Index of companies of 50 to 250 employees (art. L1142-8, D1142-2): publication by 1 March at the latest, declaration on Egapro, results filed in the BDESE. Groups of fewer than 3 people of one sex are excluded from indicator 1. Indicator 3: Cursus knows the returns from leave, not the pay rises.')}
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
    <Panel title={t('Annual freezes')} aside={admin && !cibleArretee
      ? <Btn variant="primary" small icon={<LockSimpleIcon size={14} />} onClick={() => openDialog({ type: 'confirmer', c: confirmationArreter(cible, seuil) })}>{t('Freeze ')}{cible}</Btn>
      : undefined} style={{ gap: 'var(--space-3)' }}>
      {tries.length === 0 ? <Empty pad="sm">{t('No freeze: the figures shown are calculated at each consultation.')}</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <caption className="sr-only">{t('Annual freezes of the social indicators')}</caption>
            <thead><tr><th scope="col">{t('Year')}</th><th scope="col">{t('Freeze')}</th><th scope="col">{t('State')}</th><th scope="col"><span className="sr-only">{t('Actions')}</span></th></tr></thead>
            <tbody>
              {tries.map(a => (
                <tr key={a.id}>
                  <th scope="row" className="tnum">{a.annee}</th>
                  <td><div>{t('no. ')}{a.id}</div><div className="text-muted sub">{resumeArrete(a)}</div>
                    {a.annuleLe && a.annuleMotif && <div className="text-muted sub">{t('Reason: ')}{a.annuleMotif}</div>}</td>
                  <td>{a.annuleLe ? <Tag cls="tag-outline">{t('Cancelled#masc')}</Tag> : a.cseLe ? <Tag cls="tag-accent">{t('At the CSE')}</Tag> : <Tag cls="tag-neutral">{t('In force')}</Tag>}</td>
                  <td>
                    <div className="actions-end" style={{ flexWrap: 'wrap' }}>
                      <Btn small onClick={() => setUi({ indAnnee: a.annee, indOnglet: 'bdese' })}>{t('See the BDESE')}</Btn>
                      {rh && !a.annuleLe && <Btn small onClick={() => openDialog({ type: 'arreteCse', id: a.id })}>{t(a.cseLe ? 'Change the date of the CSE' : 'Made available to the CSE')}</Btn>}
                      {admin && !a.annuleLe && <Btn small onClick={() => openDialog({ type: 'confirmer', c: confirmationAnnuler(a) })}>{t('Cancel')}</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fine>
        {t('The freeze fixes the aggregates of a closed year, already masked, by grouping (overall, sex, category, status, contract; never the team), with the threshold and the version of the rules: the retention purges (time 3 years, files 5 years) and the corrections no longer change the figures of N-2 presented to the CSE. It is never deleted: it is cancelled with a reason (HR only, never in the log). The CSE has no access to Cursus: print or export the BDESE, file it, then note the date it was made available. ')}{admin ? '' : t('Freeze or cancel: HR administrator.')}
        {enVigueur ? ` ${annee}${t(': freeze no. ')}${enVigueur.id}${t(' in force.')}` : annee >= courante ? ` ${annee}${t(' is not over: it can only be frozen from 1 January ')}${annee + 1}.` : ''}
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
  const seuilTexte = onglet === 'bdese' ? texteSeuils(bdese) : `${t('anonymity threshold ')}${seuil}`;

  // Onglet BDESE : les trois années et les groupements de la BDESE en un fichier (route dédiée) ; ailleurs, l'onglet affiché.
  const exporter = () => {
    (onglet === 'bdese' ? exporterBdese(annee, d.ds.user.role) : exporterIndicateurs(requete, d.ds.user.role)).then(nom => notify(`${t('CSV export generated — ')}${nom}`), (e: Error) => notify(e.message, true));
  };
  const imprimer = () => {
    if (!r) return;
    const titre = `${t('Social indicators ')}${annee} — ${t(LIBELLE_ONGLET[onglet])}`;
    const sections = onglet === 'bdese' ? sectionsBdese(bdese)
      : onglet === 'egalite' ? sectionsEgalite(r)
      : sectionsTableaux((TABLEAUX_ONGLET[onglet] ?? []).map(id => tableauDe(r, id)).filter((tb): tb is TableauIndicateur => !!tb), r.seuil);
    if (!printDocument(titre, onglet === 'bdese' ? `BDESE (art. R2312-9) · ${bdese.map(colonneAnnee).join(' · ')}` : origine(r), sections)) {
      notify(t('Printing impossible: allow pop-up windows'), true);
    }
  };

  const masquees = r ? casesMasquees(r) : 0;
  let contenu: ReactNode;
  if (onglet === 'arretes') contenu = <OngletArretes arretes={arretes} annee={annee} courante={courante} seuil={d.ds.settings.indicateursSeuil} />;
  else if (erreur) contenu = <Panel><p role="alert" style={{ margin: 0 }}>{erreur}</p></Panel>;
  else if (!r) contenu = <Panel><Empty pad="sm">{t('Calculating the indicators…')}</Empty></Panel>;
  else if (onglet === 'bdese') contenu = <OngletBdese annees={bdese} />;
  else if (onglet === 'egalite') contenu = <OngletEgalite r={r} />;
  else {
    const tableaux = (TABLEAUX_ONGLET[onglet] ?? []).map(id => tableauDe(r, id)).filter((tb): tb is TableauIndicateur => !!tb);
    contenu = <>
      {onglet === 'effectifs' && <KpisEffectifs r={r} />}
      {tableaux.map(tb => <PanneauTableau key={tb.id} tb={tb} seuil={r.seuil} />)}
    </>;
  }

  return (
    <Page kicker={`${t('BDESE and gender equality at work')} · ${t('year ')}${annee}${figes ? ` · ${t('freeze no. ')}${enVigueur.id}` : ''} · ${seuilTexte}`} title={t('Social indicators')}
      actions={<>
        <select className="input" aria-label={t('Year')} value={annee} onChange={e => setUi({ indAnnee: Number(e.target.value) === courante ? null : Number(e.target.value) })} style={{ width: 'auto' }}>
          {anneesProposees(courante, arretes).map(a => <option key={a} value={a}>{a}{a === courante ? t(' (in progress)') : ''}</option>)}
        </select>
        {avecGroupe && (
          <select className="input" aria-label={t('Grouping')} value={groupe} onChange={e => setUi({ indGroupe: e.target.value as GroupeIndicateurs })} style={{ width: 'auto' }}>
            {(Object.keys(GROUPES_INDICATEURS) as GroupeIndicateurs[]).map(g => <option key={g} value={g}>{g === 'aucun' ? t('Without grouping') : `${t('By ')}${GROUPES_INDICATEURS[g].toLowerCase()}`}</option>)}
          </select>
        )}
        {onglet !== 'arretes' && r && <>
          <Btn variant="secondary" icon={<DownloadSimpleIcon size={14} />} onClick={exporter}>{t('Export (CSV)')}</Btn>
          <Btn variant="secondary" icon={<PrinterIcon size={14} />} onClick={imprimer}>{t('Print')}</Btn>
        </>}
      </>}>
      <Seg name="indOnglet" label={t('Indicators shown')} value={onglet} onChange={o => setUi({ indOnglet: o })} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
        options={ONGLETS_INDICATEURS.map(o => [o, t(LIBELLE_ONGLET[o])])} />
      {enVigueur && onglet !== 'arretes' && onglet !== 'bdese' && (
        <NoteAccent>
          {annee}{t(' is frozen (freeze no. ')}{enVigueur.id}, {fmtIso(enVigueur.arreteLe.slice(0, 10))}{enVigueur.cseLe ? `${t(', at the CSE on ')}${fmtIso(enVigueur.cseLe)}` : ''}).{' '}
          {groupe === 'equipe' ? t('The grouping by team is not frozen: calculation of the day. ') : ''}
          <Seg name="indSource" label={t('Figures shown')} value={calculDuJour ? 'calcul' : 'arrete'} onChange={v => setCalculDuJour(v === 'calcul')}
            options={[['arrete', t('Frozen figures')], ['calcul', t('Calculation of the day')]]} disabled={groupe === 'equipe'} />
        </NoteAccent>
      )}
      {r && onglet !== 'arretes' && onglet !== 'bdese' && r.avertissements.length > 0 && (
        <Fine>{r.avertissements.join(' · ')}{masquees ? ` · ${texteMasquees(masquees)} « < ${r.seuil} »` : ''}.</Fine>
      )}
      {contenu}
      <Fine>
        {t('Aggregates calculated by the server over the calendar year, never a list of names. ')}{onglet === 'bdese' && new Set(bdese.map(a => a.seuil)).size > 1
          ? <>{t('“< k”: cell covering fewer than k people, k being the threshold of the year (that of its freeze, or the setting for a calculation of the day: ')}{texteSeuils(bdese).replace(t('anonymity thresholds: '), '')}{t('), or')}</>
          : <>{t('“< #open')}{onglet === 'bdese' ? bdese[0].seuil : seuil}{t('”: cell covering fewer than ')}{onglet === 'bdese' ? bdese[0].seuil : seuil}{t(' people, or')}</>}
        {' '}{t('that a total would allow to find by difference (anonymity threshold, Settings → Social indicators). Temporary workers without a sheet in Cursus not counted. ')}{tn(arretes.filter(a => !a.annuleLe).length, 'freeze in force', 'freezes in force')}.
      </Fine>
    </Page>
  );
}
