// Badgeage virtuel (lot 12, chantier C6, étape 2) : mention d'information des salariés (art. L1222-4 du Code du travail,
// art. 13 du RGPD), générée d'après les réglages pour l'affichage et la note de service. Un pointage tiré d'un dispositif
// dont les salariés n'ont pas été informés au préalable leur est inopposable. Le texte est proposé par Paramètres →
// Badgeage (client/src/pages/parametres/Badgeage.tsx) et repris dans docs/RGPD.md ; il reste à relire par le DPO. Étape 3 :
// paragraphe de la géolocalisation au pointage quand l'option est active.
import { fmtIso } from '../format.ts';
import type { Settings } from '../types.ts';
import { CRITERES_POPULATION, MODES_TEMPS } from './pointage.ts';

/** Paragraphes de la mention d'information, dans l'ordre (titre d'abord). */
export function mentionInformationPointage(s: Pick<Settings, 'pointageAccord' | 'pointageCseLe' | 'pointagePopulations' | 'pointageDelaiCorrectionJours' | 'pointageHorsLigne' | 'conservationPointagesAns'> & { pointageInterim?: boolean }
  & Partial<Pick<Settings, 'geolocActive' | 'geolocPopulations' | 'geolocFinalite'>>): string[] {
  // Étape 3 : géolocalisation au pointage, pour les seules populations désignées (option active).
  const geoloc = s.geolocActive && (s.geolocPopulations ?? []).length
    ? ` Pour ${(s.geolocPopulations ?? []).map(p => `${CRITERES_POPULATION[p.critere].toLowerCase()} « ${p.valeur} »`).join(', ')} seulement, la position du téléphone est lue une fois, au moment du clic sur « Pointer » (jamais en continu ni sans réseau), pour vérifier la présence sur une zone de pointage (finalité : ${s.geolocFinalite || '[à compléter]'}) ; seul le résultat (dans la zone, hors zone, position imprécise ou non partagée) est gardé, jamais la position. Vous pouvez refuser : le pointage est enregistré quand même, sans sanction. Aucune photo ni donnée biométrique n’est enregistrée.`
    : ' Aucune position, aucune photo ni donnée biométrique n’est enregistrée.';
  const populations = (s.pointagePopulations ?? []).map(p => `${CRITERES_POPULATION[p.critere].toLowerCase()} « ${p.valeur} » : ${MODES_TEMPS[p.mode].toLowerCase()}, à compter du ${fmtIso(p.effet)}`);
  return [
    'Information des salariés : pointage des heures de travail',
    `Finalité : décompter la durée du travail de chaque salarié (art. D3171-8 du Code du travail) et contrôler le respect des repos et des durées maximales. Fondement : l’accord d’entreprise ${s.pointageAccord || '[référence à compléter]'} ; le CSE a été consulté le ${s.pointageCseLe ? fmtIso(s.pointageCseLe) : '[date à compléter]'} (art. L2312-38).`,
    populations.length ? `Salariés concernés : ${populations.join(' ; ')}. Ne pointent jamais : les salariés au forfait jours et les cadres dirigeants${s.pointageInterim ? '' : ', ni les intérimaires'}.` : 'Salariés concernés : aucune population n’est encore désignée.',
    `Fonctionnement : un bouton « Pointer » dans Cursus, sur le téléphone ou l’ordinateur, enregistre l’heure du serveur à l’arrivée et au départ.${s.pointageHorsLigne ? ' Sans réseau, le pointage est gardé sur l’appareil avec son heure et envoyé « différé » au retour du réseau.' : ''}${geoloc}`,
    `Corrections : un pointage oublié ou erroné se corrige par une demande, faite dans les ${s.pointageDelaiCorrectionJours} jours et validée par le manager ou le service RH ; aucune saisie n’est jamais modifiée ni supprimée.`,
    'Destinataires : le salarié, son manager (ou son suppléant pour les feuilles de temps) et le service RH. La paie reçoit les heures de la feuille de temps validée, jamais les pointages.',
    `Durée de conservation : ${s.conservationPointagesAns} an${s.conservationPointagesAns > 1 ? 's' : ''}, puis effacement automatique.`,
    'Vos droits : accès et copie depuis votre espace (« Télécharger mes données »), rectification par une demande de correction, réclamation auprès de la CNIL. Contact : le service RH ou le délégué à la protection des données (page Confidentialité de Cursus).',
  ];
}
