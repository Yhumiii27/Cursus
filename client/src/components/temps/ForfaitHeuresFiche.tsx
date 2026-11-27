// Forfait annuel en heures (lot 12, chantier C1, étape 2) hors de l'onglet de l'écran Temps :
// - `ForfaitHeuresFiche` : ligne de la section Contrat de la fiche collaborateur (service RH, paie, lecture seule, manager de
//   l'équipe) : réalisé de la période en cours, cible (nette des absences pour le service RH et la paie seulement),
//   projection, état de la dernière clôture ; jamais pour le référent HSE (ni feuilles ni paie) ;
// - `ForfaitHeuresEnAttente` : heures des clôtures confirmées en attente d'un lot de paie (écran Temps, components/LotsPaie.tsx) :
//   rubrique active, ou à saisir dans Sage (HFA25, HFA50, HCA10, HCA25 désactivées par défaut) ; période d'émission comprise.
import { useMemo } from 'react';
import { fH, fmtIso } from '../../../../shared/format.ts';
import { concerneParForfaitHeures, elementsForfaitHeures, ligneEnVigueur, plagesACloreDe, suiviForfaitHeures, versionsDe } from '../../../../shared/rules/forfait-heures.ts';
import { FORMAT_FICHIER_DEFAUT } from '../../../../shared/rules/lots-paie.ts';
import { periodeLabel, rubriquesPaie } from '../../../../shared/rules/paie.ts';
import type { Employe } from '../../../../shared/types.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { Fine, NoteAccent } from '../ui.tsx';
import { etatTexte, voitQuantites, voitRecalcul } from './forfait-heures-vue.ts';
import { useDroitsForfaitHeures } from './RecapForfaitHeures.tsx';
import { t } from '../../i18n/langue.ts';

/** Ligne de la fiche collaborateur : forfait annuel en heures de la période en cours et dernière clôture. */
export function ForfaitHeuresFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const r = useDroitsForfaitHeures();
  // Salarié jamais au forfait : rien à calculer (la fiche s'ouvre pour tous).
  const suivis = useMemo(() => (concerneParForfaitHeures(d, e) ? suiviForfaitHeures(d, e) : []), [d, e]);
  const lignes = (d.ds.cloturesForfaitHeures ?? []).filter(l => l.empId === e.id);
  const derniere = [...lignes].sort((a, b) => b.debut.localeCompare(a.debut))[0];
  const enVigueur = derniere ? ligneEnVigueur(lignes, e.id, derniere.debut) : null;
  // Plages à clôturer du seul salarié affiché (jamais le calcul de tous les salariés à l'ouverture d'une fiche).
  const aClore = useMemo(() => (r.rh ? plagesACloreDe(d, e) : []), [d, e, r.rh]);
  if (!(r.rh || r.paie || r.consultation || r.manager)) return null;
  if (!suivis.length && !enVigueur && !aClore.length) return null;
  // Cible nette recalculée : service RH et le salarié lui-même (la paie lit les lignes confirmées : `voitRecalcul`).
  const q = voitQuantites(r, e.id), net = voitRecalcul(r, e.id);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div className="text-muted sub">{t('Annual hours package')}</div>
      {suivis.map(s => (
        <div key={s.calc.debut}>
          <div className="tnum" style={{ fontSize: 14 }}>
            {fH(s.calc.realise)}{t(' worked#hours')} / {net ? `${fH(s.calc.cibleNette)}${t(' net target')}` : `${fH(s.calc.cible)}${t(' target')}`}
          </div>
          <div className="text-muted sub">
            {t('From#cap-du-short')}{fmtIso(s.calc.debut)}{t(' to #au')}{fmtIso(s.calc.fin)}{t(' · package of ')}{fH(s.calc.forfait)}
            {net && s.calc.absences ? ` · ${fH(s.calc.absences)}${t(' of absences deducted')}` : ''}
            {s.projection != null ? `${t(' · projection ')}${fH(s.projection)}` : ''}
          </div>
        </div>
      ))}
      {q && enVigueur && <div className="text-muted sub">{t('Last closure (from ')}{fmtIso(enVigueur.debut)}{t(' to #au')}{fmtIso(enVigueur.fin)}{versionsDe(lignes, e.id, enVigueur.debut).length > 1 ? `${t(', version ')}${enVigueur.version}` : ''}){t(': ')}{etatTexte(enVigueur, null)}</div>}
      {aClore.length > 0 && <NoteAccent>{aClore.length > 1 ? `${aClore.length}${t(' periods ended')}` : t('Period ended')}{t(' to close: Working time screen, “Annual hours package” tab.')}</NoteAccent>}
    </div>
  );
}

/** Heures des clôtures du forfait annuel en heures en attente d'un lot de paie (écran Temps, transmission à Sage). */
export function ForfaitHeuresEnAttente() {
  const d = useDomain();
  const { paie, rh } = useRole();
  if (!paie && !rh) return null;
  // Format du fichier : un écart négatif refusé part « à saisir dans Sage », comme le calcule le serveur.
  const elements = elementsForfaitHeures(d, '9999-12', rubriquesPaie(d.ds.rubriquesPaie), (d.ds.formatFichierPaie ?? FORMAT_FICHIER_DEFAUT).negatifs !== false);
  if (!elements.length) return null;
  const texte = (l: typeof elements) => l.map(x => `${d.personName(x.empId)} (${x.rubrique} ${fH(x.quantite)}${x.correctif ? t(', difference') : ''}, ${periodeLabel(x.periode)})`).join(', ');
  const dansLeFichier = elements.filter(x => x.codeSage), aSaisir = elements.filter(x => !x.codeSage);
  return (
    <Fine>
      {dansLeFichier.length > 0 && `${t('Closure hours of the annual hours package in the next batch of their period: ')}${texte(dansLeFichier)}. `}
      {aSaisir.length > 0 && `${t('Closure hours of the annual hours package to enter in Sage (HFA and HCA items disabled): ')}${texte(aSaisir)}${t('; each batch lists them in its summary.')}`}
    </Fine>
  );
}
