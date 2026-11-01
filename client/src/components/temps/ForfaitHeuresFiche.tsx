// Forfait annuel en heures (lot 12, chantier C1, étape 2) hors de l'onglet de l'écran Temps :
// - `ForfaitHeuresFiche` : ligne de la section Contrat de la fiche collaborateur (service RH, paie, lecture seule, manager de
//   l'équipe) : réalisé de la période en cours, cible (nette des absences pour le service RH et la paie seulement),
//   projection, état de la dernière clôture ; jamais pour le référent HSE (ni feuilles ni paie) ;
// - `ForfaitHeuresEnAttente` : heures des clôtures confirmées en attente d'un lot de paie (écran Temps, components/LotsPaie.tsx) :
//   rubrique active, ou à saisir dans Sage (HFA25, HFA50, HCA10, HCA25 désactivées par défaut) ; période d'émission comprise.
import { useMemo } from 'react';
import { fH, fmtIso } from '../../../../shared/format.ts';
import { concerneParForfaitHeures, elementsForfaitHeures, ligneEnVigueur, plagesAClore, suiviForfaitHeures, versionsDe } from '../../../../shared/rules/forfait-heures.ts';
import { periodeLabel, rubriquesPaie } from '../../../../shared/rules/paie.ts';
import type { Employe } from '../../../../shared/types.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { Fine, NoteAccent } from '../ui.tsx';
import { etatTexte, voitQuantites } from './forfait-heures-vue.ts';
import { useDroitsForfaitHeures } from './RecapForfaitHeures.tsx';

/** Ligne de la fiche collaborateur : forfait annuel en heures de la période en cours et dernière clôture. */
export function ForfaitHeuresFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const r = useDroitsForfaitHeures();
  // Salarié jamais au forfait : rien à calculer (la fiche s'ouvre pour tous).
  const suivis = useMemo(() => (concerneParForfaitHeures(d, e) ? suiviForfaitHeures(d, e) : []), [d, e]);
  const lignes = (d.ds.cloturesForfaitHeures ?? []).filter(l => l.empId === e.id);
  const derniere = [...lignes].sort((a, b) => b.debut.localeCompare(a.debut))[0];
  const enVigueur = derniere ? ligneEnVigueur(lignes, e.id, derniere.debut) : null;
  const aClore = useMemo(() => (r.rh && concerneParForfaitHeures(d, e) ? plagesAClore(d).filter(p => p.e.id === e.id) : []), [d, e, r.rh]);
  if (!(r.rh || r.paie || r.consultation || r.manager)) return null;
  if (!suivis.length && !enVigueur && !aClore.length) return null;
  const q = voitQuantites(r, e.id);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div className="text-muted sub">Forfait annuel en heures</div>
      {suivis.map(s => (
        <div key={s.calc.debut}>
          <div className="tnum" style={{ fontSize: 14 }}>
            {fH(s.calc.realise)} réalisées / {q ? `${fH(s.calc.cibleNette)} de cible nette` : `${fH(s.calc.cible)} de cible`}
          </div>
          <div className="text-muted sub">
            Du {fmtIso(s.calc.debut)} au {fmtIso(s.calc.fin)} · forfait de {fH(s.calc.forfait)}
            {q && s.calc.absences ? ` · ${fH(s.calc.absences)} d’absences déduites` : ''}
            {s.projection != null ? ` · projection ${fH(s.projection)}` : ''}
          </div>
        </div>
      ))}
      {q && enVigueur && <div className="text-muted sub">Dernière clôture (du {fmtIso(enVigueur.debut)} au {fmtIso(enVigueur.fin)}{versionsDe(lignes, e.id, enVigueur.debut).length > 1 ? `, version ${enVigueur.version}` : ''}) : {etatTexte(enVigueur, null)}</div>}
      {aClore.length > 0 && <NoteAccent>{aClore.length > 1 ? `${aClore.length} plages terminées` : 'Plage terminée'} à clôturer : écran Temps de travail, onglet « Forfait annuel en heures ».</NoteAccent>}
    </div>
  );
}

/** Heures des clôtures du forfait annuel en heures en attente d'un lot de paie (écran Temps, transmission à Sage). */
export function ForfaitHeuresEnAttente() {
  const d = useDomain();
  const { paie, rh } = useRole();
  if (!paie && !rh) return null;
  const elements = elementsForfaitHeures(d, '9999-12', rubriquesPaie(d.ds.rubriquesPaie));
  if (!elements.length) return null;
  const texte = (l: typeof elements) => l.map(x => `${d.personName(x.empId)} (${x.rubrique} ${fH(x.quantite)}${x.correctif ? ', écart' : ''}, ${periodeLabel(x.periode)})`).join(', ');
  const dansLeFichier = elements.filter(x => x.codeSage), aSaisir = elements.filter(x => !x.codeSage);
  return (
    <Fine>
      {dansLeFichier.length > 0 && `Heures de clôture du forfait annuel en heures dans le prochain lot de leur période : ${texte(dansLeFichier)}. `}
      {aSaisir.length > 0 && `Heures de clôture du forfait annuel en heures à saisir dans Sage (rubriques HFA et HCA désactivées) : ${texte(aSaisir)} ; chaque lot les liste dans son résumé.`}
    </Fine>
  );
}
