// Jours de fractionnement des congés payés (`conges.fractionnement`, service RH, t046) : après la fin de la période du
// congé principal (31 octobre par défaut), Cursus propose pour chaque salarié les jours dus (shared/rules/fractionnement.ts) ;
// le service RH les crédite ou note la renonciation individuelle du salarié (art. L3141-19), ligne par ligne, jamais d'office.
// Le crédit est un report reçu sur la période (`origine` « fractionnement », jusqu'à sa fin au 31 mai) : il compte dans les
// droits (`cpDroit`), le solde, la clôture et le solde de sortie comme tout report reçu. Une décision par salarié et par
// période (table `fractionnements`, unique) : une ligne déjà décidée (double envoi, autre onglet, autre membre du RH)
// est ignorée et comptée dans le message, les autres sont enregistrées. Un membre du RH ne décide pas pour lui-même.
import { fJ, fmtIso, plural } from '../../../shared/format.ts';
import { finPeriodeCp, periodeCp } from '../../../shared/rules/conges.ts';
import { CREDIT_MAX, fenetrePrincipale, fractionnementsAProposer, regleFractionnement } from '../../../shared/rules/fractionnement.ts';
import type { Fractionnement, ReportCp } from '../../../shared/types.ts';
import { ActionError, type ActionHandler, refuserSoiMeme, requireRh } from './context.ts';

/** Motif du report reçu qui porte le crédit (code fixe, jamais un texte saisi). */
export const MOTIF_FRACTIONNEMENT = 'Jours de fractionnement (art. L3141-23)';

/** Décision reçue pour un salarié : `crediter` (jours) ou `renoncer` (renonciation écrite du salarié) ; absente : plus tard. */
interface Decision { empId: unknown; decision: unknown; jours?: unknown }

/** Période `periode` (année de prise), lignes [{ empId, decision, jours? }] ; les salariés sans ligne restent à décider. */
const decider: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const A = Number(p.periode);
  if (!Number.isInteger(A) || A < 2000 || A > 2200) throw new ActionError('Période de congés payés invalide');
  const regle = regleFractionnement(ctx.ds.settings);
  if (regle === 'aucun') throw new ActionError('Jours de fractionnement écartés par accord collectif (Paramètres → Fractionnement des congés) : rien à créditer');
  const f = fenetrePrincipale(ctx.ds.settings, A);
  if (ctx.d.ti <= f.au) throw new ActionError(`Période du congé principal en cours jusqu’au ${fmtIso(f.au)} : les jours de fractionnement se décident à partir du lendemain`);
  const lignes = fractionnementsAProposer(ctx.d, A);
  const recues: Decision[] = Array.isArray(p.lignes) ? p.lignes.filter((x: unknown) => x && typeof x === 'object').slice(0, 2000) : [];
  const max = CREDIT_MAX[regle];
  let credites = 0, jours = 0, renonces = 0, deja = 0;
  const vus = new Set<number>();
  for (const x of recues) {
    // Déjà décidé pour cette période : rien n'est refait (la décision enregistrée tient), comme une ligne déjà close.
    if ((ctx.ds.fractionnements ?? []).some(y => y.empId === Number(x.empId) && y.periode === A)) {
      deja++;
      continue;
    }
    const l = lignes.find(y => y.e.id === Number(x.empId));
    if (l && vus.has(l.e.id)) throw new ActionError(`${l.e.nom} : une seule décision par salarié`);
    if (l) vus.add(l.e.id);
    if (!l) throw new ActionError(`Salarié sans jours de fractionnement à décider sur la période ${periodeCp(A)} (période clôturée, sorti ou intérimaire)`);
    refuserSoiMeme(ctx, l.e, 'Vous ne pouvez pas décider de vos propres jours de fractionnement');
    const base = { empId: l.e.id, periode: A, le: ctx.d.ti, par: ctx.user.nom };
    if (x.decision === 'renoncer') {
      ctx.db.insert<Fractionnement>('fractionnements', { ...base, decision: 'renonce', jours: 0, reportId: null });
      renonces++;
      continue;
    }
    if (x.decision !== 'crediter') throw new ActionError(`${l.e.nom} : choisissez le crédit des jours ou la renonciation du salarié`);
    const j = Number(x.jours ?? l.propose);
    // Règle légale : 1 ou 2 jours ; accord : par demi-journée, dans la limite retenue.
    if (!(j > 0) || j > max || (regle === 'legal' ? j % 1 !== 0 : (j * 2) % 1 !== 0)) {
      throw new ActionError(`${l.e.nom} : nombre de jours de fractionnement invalide (${regle === 'legal' ? '1 ou 2 jours' : `${fJ(max)} au plus, par demi-journée`})`);
    }
    const r = ctx.db.insert<ReportCp>('reports', {
      empId: l.e.id, jours: j, motif: MOTIF_FRACTIONNEMENT, par: ctx.user.nom, date: ctx.d.ti, sens: 'recu', periode: A, expire: finPeriodeCp(A), origine: 'fractionnement',
    });
    ctx.db.insert<Fractionnement>('fractionnements', { ...base, decision: 'credite', jours: j, reportId: r.id });
    credites++;
    jours += j;
  }
  const dejaTexte = deja ? ` · ${plural(deja, 'salarié déjà décidé', 'salariés déjà décidés')} entre-temps (décision inchangée)` : '';
  if (!credites && !renonces) return `Jours de fractionnement ${periodeCp(A)} : aucune décision enregistrée${dejaTexte}`;
  const restants = lignes.length - credites - renonces;
  return `Jours de fractionnement ${periodeCp(A)} : ${plural(credites, 'salarié crédité', 'salariés crédités')}${credites ? ` (${fJ(jours)} en tout, jusqu’au ${fmtIso(finPeriodeCp(A))})` : ''}`
    + `${renonces ? `, ${plural(renonces, 'renonciation notée', 'renonciations notées')}` : ''}${restants ? ` · ${plural(restants, 'salarié reste', 'salariés restent')} à décider` : ''}${dejaTexte}`;
};

export const fractionnementActions = {
  'conges.fractionnement': decider,
} satisfies Record<string, ActionHandler>;
