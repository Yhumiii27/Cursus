// lot 11 — notes de frais (étape 2) : tableau de bord du service RH et de la comptabilité. Agrégats calculés sur
// l'instantané, jamais stockés : notes en attente par étape, délai moyen de la soumission au contrôle, dépenses des
// douze derniers mois par mois et par catégorie, allocations réintégrables, avances non soldées. Le manager a ses propres
// totaux d'équipe (pages/Frais.tsx, sans les frais médicaux : `totauxEquipe`).
// lot 12 — C2 (notes de frais : activation) : la vue du service RH et de la comptabilité porte les notes payées depuis
// moins de 13 mois (les dépenses des douze derniers mois restent couvertes) mais les dépenses des seules notes en circuit
// ou payées depuis moins de 2 mois ; mois et catégories reprennent les résumés calculés par le serveur pour les autres
// (`resumesFrais`), et le réintégrable, la part de chaque note calculée par le serveur sur l'instantané complet
// (`reintegrableFrais`, cumul kilométrique exact de l'année). Chaque indicateur dit sa période.
import { addM } from '../../../../shared/dates.ts';
import { periodeLabel } from '../../../../shared/rules/paie.ts';
import { CATEGORIES_FRAIS } from '../../../../shared/rules/frais.ts';
import { FENETRE_FRAIS_MOIS, retenuParCategorie } from '../../../../shared/rules/frais-fenetre.ts';
import { useDomain } from '../../state/derived.ts';
import { Bar, Empty, Kpi, Kpis, Panel } from '../ui.tsx';
import { depensesParMois, euros, syntheseNote } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

export function TableauFrais() {
  const d = useDomain();
  const notes = d.ds.notesFrais ?? [], lignes = d.ds.lignesFrais ?? [], resumes = d.ds.resumesFrais ?? [];
  const compte = (s: string[]) => notes.filter(n => s.includes(n.statut)).length;
  const depuis = addM(`${d.ti.slice(0, 7)}-01`, -11);
  const mois = depensesParMois(notes, lignes, depuis, resumes);
  const periode = `${periodeLabel(depuis.slice(0, 7))}${t(' to #a')}${periodeLabel(d.ti.slice(0, 7))}`;
  const max = Math.max(1, ...mois.map(m => m.montant));
  // Par catégorie, sur les notes soumises des douze derniers mois (dépenses retenues).
  const ids = new Set(notes.filter(n => n.statut !== 'brouillon' && n.statut !== 'annulee' && n.periode >= depuis.slice(0, 7)).map(n => n.id));
  const parCat = retenuParCategorie(ids, lignes, resumes);
  const cats = [...parCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(([, v]) => v));
  // Délai moyen, en jours, de la soumission au contrôle (notes contrôlées des douze derniers mois).
  const delais = notes.filter(n => n.soumiseLe && n.controleeLe && n.periode >= depuis.slice(0, 7)).map(n => (Date.parse(n.controleeLe!) - Date.parse(n.soumiseLe!)) / 86_400_000);
  const delai = delais.length ? Math.round(delais.reduce((s, x) => s + x, 0) / delais.length) : null;
  // Réintégrable : part de chaque note soumise de la fenêtre, calculée par le serveur (à défaut, par les alertes de la note).
  const parts = d.ds.reintegrableFrais;
  const reintegrable = notes.filter(n => n.statut !== 'annulee' && n.statut !== 'brouillon').reduce((s, n) => s + (parts ? parts[n.id] ?? 0 : syntheseNote(d, n).reintegrable), 0);
  const avances = (d.ds.avancesFrais ?? []).filter(a => a.statut === 'validee' || a.statut === 'en_paiement' || a.statut === 'versee');

  return (
    <>
      <Kpis>
        <Kpi kicker={t('To approve (manager)')} value={compte(['soumise'])} sub={t('notes submitted')} />
        <Kpi kicker={t('To check#controle')} value={compte(['validee'])} sub={t('notes approved')} />
        <Kpi kicker={t('Waiting for payroll')} value={compte(['controlee', 'en_paiement'])} sub={t('checked or in a batch')} />
        <Kpi kicker={t('Average delay')} value={delai === null ? '—' : `${delai}${t(' d#days')}`} sub={t('from submission to check, notes of the last twelve months')} />
      </Kpis>
      <Panel title={t('Expenses of the last twelve months')} aside={`${periode}${t(' · amounts retained, notes submitted')}`}>
        {mois.length === 0 ? <Empty>{t('No expense over the period.')}</Empty> : (
          <table className="table">
            <thead><tr><th>{t('Month')}</th><th>{t('Notes')}</th><th>{t('Amount')}</th><th><span className="sr-only">{t('Share')}</span></th></tr></thead>
            <tbody>{mois.map(m => (
              <tr key={m.mois}><td>{periodeLabel(m.mois)}</td><td className="tnum">{m.notes}</td><td className="tnum nowrap">{euros(m.montant)}</td><td style={{ width: '40%' }}><Bar pct={(m.montant / max) * 100} /></td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Panel title={t('By category')} aside={`${periode}${t(' · amounts retained')}`}>
        {cats.length === 0 ? <Empty>{t('No expense over the period.')}</Empty> : (
          <table className="table">
            <thead><tr><th>{t('Category')}</th><th>{t('Amount')}</th><th><span className="sr-only">{t('Share')}</span></th></tr></thead>
            <tbody>{cats.map(([c, v]) => (
              <tr key={c}><td>{CATEGORIES_FRAIS[c].label}</td><td className="tnum nowrap">{euros(Math.round(v * 100) / 100)}</td><td style={{ width: '40%' }}><Bar pct={(v / maxCat) * 100} /></td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Kpis>
        <Kpi kicker={t('Reinstatable')} value={euros(Math.round(reintegrable * 100) / 100)} sub={`${t('allowances beyond the exemption limits, notes submitted in the circuit or paid less than ')}${FENETRE_FRAIS_MOIS}${t(' months ago')}`} />
        <Kpi kicker={t('Advances in progress')} value={euros(avances.reduce((s, a) => s + a.montant, 0))} sub={tn(avances.length, 'advance approved or paid', 'advances approved or paid')} />
      </Kpis>
    </>
  );
}
