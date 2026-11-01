// lot 11 — notes de frais (étape 2) : tableau de bord du service RH et de la comptabilité. Agrégats calculés sur
// l'instantané, jamais stockés : notes en attente par étape, délai moyen de la soumission au contrôle, dépenses des
// douze derniers mois par mois et par catégorie, allocations réintégrables, avances non soldées. Le manager a ses propres
// totaux d'équipe (pages/Frais.tsx, sans les frais médicaux : `totauxEquipe`).
// lot 12 — C2 (notes de frais : activation) : l'instantané porte les notes payées depuis moins de 13 mois (les dépenses des
// douze derniers mois restent couvertes) mais les dépenses des seules notes en circuit ou payées depuis moins de 2 mois ;
// mois et catégories reprennent les résumés calculés par le serveur pour les autres (`resumesFrais`). Chaque indicateur
// dit sa période ; le réintégrable (alertes des dépenses) ne porte que sur les notes dont le détail est dans l'instantané.
import { addM } from '../../../../shared/dates.ts';
import { plural } from '../../../../shared/format.ts';
import { periodeLabel } from '../../../../shared/rules/paie.ts';
import { CATEGORIES_FRAIS } from '../../../../shared/rules/frais.ts';
import { DETAIL_FRAIS_MOIS, retenuParCategorie } from '../../../../shared/rules/frais-fenetre.ts';
import { useDomain } from '../../state/derived.ts';
import { Bar, Empty, Kpi, Kpis, Panel } from '../ui.tsx';
import { depensesParMois, euros, syntheseNote } from './commun.ts';

export function TableauFrais() {
  const d = useDomain();
  const notes = d.ds.notesFrais ?? [], lignes = d.ds.lignesFrais ?? [], resumes = d.ds.resumesFrais ?? [];
  const compte = (s: string[]) => notes.filter(n => s.includes(n.statut)).length;
  const depuis = addM(`${d.ti.slice(0, 7)}-01`, -11);
  const mois = depensesParMois(notes, lignes, depuis, resumes);
  const periode = `${periodeLabel(depuis.slice(0, 7))} à ${periodeLabel(d.ti.slice(0, 7))}`;
  const max = Math.max(1, ...mois.map(m => m.montant));
  // Par catégorie, sur les notes soumises des douze derniers mois (dépenses retenues).
  const ids = new Set(notes.filter(n => n.statut !== 'brouillon' && n.statut !== 'annulee' && n.periode >= depuis.slice(0, 7)).map(n => n.id));
  const parCat = retenuParCategorie(ids, lignes, resumes);
  const cats = [...parCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(([, v]) => v));
  // Délai moyen, en jours, de la soumission au contrôle (notes contrôlées des douze derniers mois).
  const delais = notes.filter(n => n.soumiseLe && n.controleeLe && n.periode >= depuis.slice(0, 7)).map(n => (Date.parse(n.controleeLe!) - Date.parse(n.soumiseLe!)) / 86_400_000);
  const delai = delais.length ? Math.round(delais.reduce((s, x) => s + x, 0) / delais.length) : null;
  // Réintégrable : alertes des dépenses, calculées sur les seules notes dont le détail est dans l'instantané.
  const reintegrable = notes.filter(n => n.statut !== 'annulee' && n.statut !== 'brouillon').map(n => syntheseNote(d, n)).filter(s => s.detail).reduce((s, x) => s + x.reintegrable, 0);
  const avances = (d.ds.avancesFrais ?? []).filter(a => a.statut === 'validee' || a.statut === 'en_paiement' || a.statut === 'versee');

  return (
    <>
      <Kpis>
        <Kpi kicker="À valider (manager)" value={compte(['soumise'])} sub="notes soumises" />
        <Kpi kicker="À contrôler" value={compte(['validee'])} sub="notes validées" />
        <Kpi kicker="En attente de la paie" value={compte(['controlee', 'en_paiement'])} sub="contrôlées ou dans un lot" />
        <Kpi kicker="Délai moyen" value={delai === null ? '—' : `${delai} j`} sub="de la soumission au contrôle, notes des douze derniers mois" />
      </Kpis>
      <Panel title="Dépenses des douze derniers mois" aside={`${periode} · montants retenus, notes soumises`}>
        {mois.length === 0 ? <Empty>Aucune dépense sur la période.</Empty> : (
          <table className="table">
            <thead><tr><th>Mois</th><th>Notes</th><th>Montant</th><th><span className="sr-only">Part</span></th></tr></thead>
            <tbody>{mois.map(m => (
              <tr key={m.mois}><td>{periodeLabel(m.mois)}</td><td className="tnum">{m.notes}</td><td className="tnum nowrap">{euros(m.montant)}</td><td style={{ width: '40%' }}><Bar pct={(m.montant / max) * 100} /></td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Panel title="Par catégorie" aside={`${periode} · montants retenus`}>
        {cats.length === 0 ? <Empty>Aucune dépense sur la période.</Empty> : (
          <table className="table">
            <thead><tr><th>Catégorie</th><th>Montant</th><th><span className="sr-only">Part</span></th></tr></thead>
            <tbody>{cats.map(([c, v]) => (
              <tr key={c}><td>{CATEGORIES_FRAIS[c].label}</td><td className="tnum nowrap">{euros(Math.round(v * 100) / 100)}</td><td style={{ width: '40%' }}><Bar pct={(v / maxCat) * 100} /></td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Kpis>
        <Kpi kicker="Réintégrable" value={euros(Math.round(reintegrable * 100) / 100)} sub={`allocations au-delà des limites d’exonération, notes en circuit ou payées depuis moins de ${DETAIL_FRAIS_MOIS} mois`} />
        <Kpi kicker="Avances en cours" value={euros(avances.reduce((s, a) => s + a.montant, 0))} sub={plural(avances.length, 'avance validée ou versée', 'avances validées ou versées')} />
      </Kpis>
    </>
  );
}
