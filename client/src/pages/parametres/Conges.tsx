// Paramètres → Congés et clôtures : proposition faite à la clôture des congés payés (administrateur RH), acquisition des CP
// pendant un arrêt maladie (minimum légal ou maladie assimilée), date à partir de laquelle les RTT de l'année suivante se
// posent, et clôtures déjà faites (périodes de CP au 31 mai, RTT au 31 décembre).
import { parse } from '../../../../shared/dates.ts';
import { fJ, fmt, plural } from '../../../../shared/format.ts';
import { RTT_ANNEE_SUIVANTE_DES } from '../../../../shared/reglages.ts';
import { periodeCp } from '../../../../shared/rules/conges.ts';
import type { ClotureConges } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Fine, Panel, SectionLabel, Seg } from '../../components/ui.tsx';
import { useRole } from '../../state/derived.ts';
import { useData } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

/** Libellé d'un jour « MM-JJ » de l'année : « 1er octobre ». */
const jourDeLAnnee = (mmjj: string) => fmt(parse(`2000-${mmjj}`)).replace(/ 2000$/, '').replace(/^1 /, '1er ');

/** Clôtures faites, une ligne par période : salariés, jours reportés et perdus, date de la dernière ligne. */
function bilans(clotures: ClotureConges[]) {
  const par = new Map<string, ClotureConges[]>();
  for (const c of clotures) par.set(`${c.type}|${c.periode}`, [...(par.get(`${c.type}|${c.periode}`) ?? []), c]);
  return [...par.values()].map(l => ({
    type: l[0].type, periode: l[0].periode, n: l.length, le: l.map(c => c.le).sort().at(-1)!,
    reportes: l.reduce((s, c) => s + c.reportes, 0), perdus: l.reduce((s, c) => s + c.perdus, 0),
  })).sort((a, b) => b.le.localeCompare(a.le) || b.periode - a.periode);
}

export function Conges({ s }: SectionProps) {
  const data = useData();
  const { admin } = useRole();
  const save = useEnregistrerReglages();
  const faites = bilans(data.clotures);
  return (
    <Panel title="Congés et clôtures" style={{ gap: 'var(--space-4)' }}>
      <Field label="Clôture des congés payés au 31 mai">
        <Seg name="param-report-cp" label="Clôture des congés payés au 31 mai" value={s.politiqueReportCp} disabled={!admin}
          options={[['cas_par_cas', 'Décision au cas par cas'], ['proposer_report', 'Proposer le report du solde']]} onChange={v => save({ politiqueReportCp: v })} />
      </Field>
      <Fine>
        Aucun jour n’est perdu d’office : à partir du 1er juin, le service RH choisit pour chaque salarié le report du solde (plafonné au solde,
        jusqu’au 31 mai suivant) ou sa perte. « Proposer le report » préremplit le report de tout le solde, à confirmer. Après une absence de santé,
        une maternité, une paternité ou une adoption, les jours acquis pendant l’absence et ceux qu’elle a empêché de prendre ne se perdent pas :
        report de 15 mois (art. L3141-19-1), qui court à partir de l’information du salarié à son retour.
      </Fine>
      <Field label="Congés payés acquis pendant un arrêt maladie">
        <Seg name="param-cp-maladie" label="Congés payés acquis pendant un arrêt maladie" value={s.cpMaladie} disabled={!admin}
          options={[['legal', 'Minimum légal'], ['assimile', 'Comme du travail effectif']]} onChange={v => save({ cpMaladie: v })} />
      </Field>
      <Fine>
        Minimum légal (loi du 22 avril 2024, art. L3141-5-1) : 2 jours ouvrables par mois d’arrêt, soit 1,67 jour ouvré, 24 jours ouvrables
        (20 ouvrés) par période au plus. « Comme du travail effectif » seulement si un accord d’entreprise ou la CCN Industries chimiques le prévoit.
        Accident du travail ou de trajet et maladie professionnelle comptent toujours comme du travail effectif, sans limite de durée ; une absence
        encore à qualifier compte comme une maladie.
      </Fine>
      <Field label="RTT de l’année suivante posables à partir du" htmlFor="param-rtt-suivante">
        <select className="input" id="param-rtt-suivante" value={s.rttAnneeSuivanteDes} disabled={!admin} onChange={ev => save({ rttAnneeSuivanteDes: ev.target.value })}>
          {RTT_ANNEE_SUIVANTE_DES.map(v => <option key={v} value={v}>{v ? jourDeLAnnee(v) : 'Sans restriction'}</option>)}
        </select>
      </Field>
      <Fine>
        RTT non reportables : la clôture du 31 décembre photographie les soldes non pris, après le rappel du compte épargne-temps. Ceux de l’année
        suivante se posent sur son droit : réglage des contrats 39 h (écran Congés &amp; absences) ou jours de repos du forfait. Une demande à cheval
        sur deux années est refusée.
      </Fine>
      <SectionLabel>Clôtures faites</SectionLabel>
      {faites.length > 0 ? (
        <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
          {faites.map(b => (
            <div key={`${b.type}|${b.periode}`} className="list-row">
              <div className="grow">
                <div style={{ fontSize: 14 }}>{b.type === 'CP' ? `Congés payés ${periodeCp(b.periode)}` : `RTT et jours de repos ${b.periode}`}</div>
                <div className="text-muted sub">
                  {plural(b.n, 'salarié', 'salariés')} · {b.type === 'CP' ? `${fJ(b.reportes)} reportés · ` : ''}{fJ(b.perdus)} perdus · le {fmt(parse(b.le))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Fine>Aucune période clôturée pour le moment : la première clôture est proposée à la fin de la première période tenue par Cursus.</Fine>}
    </Panel>
  );
}
