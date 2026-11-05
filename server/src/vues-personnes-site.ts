// lot 14 — personnes sur site : fiches des salariés d'entreprises extérieures (`Dataset.exterieurs`, rangées à part par
// server/src/lecture-brute.ts) dans l'instantané envoyé au navigateur, appelé par server/src/dataset.ts (contexte :
// server/src/vues-lot12.ts). Le service RH (droit « rh ») reçoit l'instantané complet. Ailleurs :
// - référent HSE et formations (droit « formations ») et lecture seule (« consultation ») : les fiches, pour leurs titres et
//   habilitations (accès aux chantiers, sessions) ;
// - paie, manager et collaborateur : rien (aucun contrat ni équipe) ; la comptabilité garde sa liste blanche
//   (server/src/frais-vues.ts), sans elles.
import type { Employe } from '../../shared/types.ts';
import type { ContexteVueProfil, ContexteVueSalarie, Projection } from './vues-lot12.ts';

/**
 * Fiche d'extérieur vue d'un profil restreint : liste blanche (identité, entreprise, matricule de site, titres en vigueur
 * et habilitations) ; ni donnée de santé, ni documents de voyage, ni motif de correction d'une certification (texte libre
 * du service RH), comme pour les salariés (`vueProfil`, server/src/dataset.ts).
 */
export function exterieurVueProfil(e: Employe): Employe {
  return {
    id: e.id, nom: e.nom, entreprise: e.entreprise ?? null, email: e.email ?? null, exterieur: true, matriculeSite: e.matriculeSite ?? null,
    equipe: null, poste: '', statut: e.statut, typeContrat: e.typeContrat, temps: e.temps, jourOff: [], entree: e.entree, fin: e.fin ?? null,
    certs: e.certs.map(c => (c.corrigeMotif || c.inscriptionsCloses ? { ...c, corrigeMotif: null, inscriptionsCloses: null } : c)),
    certsAnnulees: [], habs: e.habs, restrictions: [], vaccins: [], visas: [], visite: null, avis: null, passeport: null,
  } as Partial<Employe> as Employe;
}

/** Vue d'un manager ou d'un collaborateur : aucun extérieur. */
export function personnesSiteVueSalarie(_c: ContexteVueSalarie): Projection {
  return { exterieurs: [] };
}

/** Vue d'un profil restreint de l'espace RH : formations et lecture seule les reçoivent, la paie non. */
export function personnesSiteVueProfil({ full, droits }: ContexteVueProfil): Projection {
  return { exterieurs: droits.includes('formations') || droits.includes('consultation') ? (full.exterieurs ?? []).map(exterieurVueProfil) : [] };
}
