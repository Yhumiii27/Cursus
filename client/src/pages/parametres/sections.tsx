// Écran Paramètres : sections dans l'ordre d'affichage, une par fichier de ce dossier (ou panneau d'un autre écran).
// Ajouter une section : un fichier client/src/pages/parametres/<Nom>.tsx qui exporte son composant (SectionProps de
// commun.ts), puis une ligne ici (docs/ARCHITECTURE.md, « Cadre commun du lot 4 »). Une section réservée à un profil
// se masque elle-même (null).
import type { ComponentType } from 'react';
import { useRole } from '../../state/derived.ts';
import { ComptesPanel } from '../Comptes.tsx';
import { JournalPanel } from '../Journal.tsx';
import { MessageriePanel } from '../Messagerie.tsx';
import type { SectionProps } from './commun.ts';
import { AbsencesPaie } from './AbsencesPaie.tsx';
import { Conges } from './Conges.tsx';
import { Contrats } from './Contrats.tsx';
import { DecompteHeures } from './DecompteHeures.tsx';
import { Demonstration } from './Demonstration.tsx';
import { Entretiens } from './Entretiens.tsx';
import { EntretienMiCarriere } from './EntretienMiCarriere.tsx';
import { Envois } from './Envois.tsx';
import { FeuillesTemps } from './FeuillesTemps.tsx';
import { Formations } from './Formations.tsx';
import { Hierarchie } from './Hierarchie.tsx';
import { Keystone } from './Keystone.tsx';
import { MatriculesPaie } from './MatriculesPaie.tsx';
import { Pieces } from './Pieces.tsx';
import { PostesRisques } from './PostesRisques.tsx';
import { ReglagesPaie } from './ReglagesPaie.tsx';
import { Reprise } from './Reprise.tsx';
import { RelancesEcheances } from './RelancesEcheances.tsx';
import { ReposHebdomadaire } from './ReposHebdomadaire.tsx';
import { Rgpd } from './Rgpd.tsx';
import { SagePaie } from './SagePaie.tsx';
import { Sante } from './Sante.tsx';
import { Suivi } from './Suivi.tsx';

export interface SectionParametres {
  /** Identifiant stable (clé de rendu). */
  id: string;
  /** Colonne de gauche ou de droite (réglages, intégrations), ou pleine largeur sous les deux colonnes. */
  place: 'gauche' | 'droite' | 'large';
  Section: ComponentType<SectionProps>;
}

/** Messagerie (pages/Messagerie.tsx) : adresses et état des e-mails, rechargé avec les envois. */
const Messagerie = ({ envois }: SectionProps) => <MessageriePanel etat={envois.etat?.email ?? null} reload={envois.recharger} />;
/** Comptes et accès (pages/Comptes.tsx) : administrateur RH. */
const Comptes = () => (useRole().admin ? <ComptesPanel /> : null);
/** Journal des actions (pages/Journal.tsx). */
const Journal = () => <JournalPanel />;

export const SECTIONS: readonly SectionParametres[] = [
  { id: 'suivi', place: 'gauche', Section: Suivi },
  { id: 'entretiens', place: 'gauche', Section: Entretiens },
  { id: 'entretien-mi-carriere', place: 'gauche', Section: EntretienMiCarriere },
  { id: 'demonstration', place: 'gauche', Section: Demonstration },
  { id: 'keystone', place: 'droite', Section: Keystone },
  { id: 'sage', place: 'droite', Section: SagePaie },
  { id: 'matricules', place: 'droite', Section: MatriculesPaie },
  { id: 'conges', place: 'gauche', Section: Conges },
  { id: 'reprise', place: 'gauche', Section: Reprise },
  { id: 'contrats', place: 'gauche', Section: Contrats },
  { id: 'paie', place: 'droite', Section: ReglagesPaie },
  { id: 'decompte', place: 'droite', Section: DecompteHeures },
  { id: 'absences-paie', place: 'droite', Section: AbsencesPaie },
  { id: 'feuilles', place: 'gauche', Section: FeuillesTemps },
  { id: 'repos', place: 'droite', Section: ReposHebdomadaire },
  { id: 'sante', place: 'gauche', Section: Sante },
  { id: 'formations', place: 'droite', Section: Formations },
  { id: 'postes-risques', place: 'droite', Section: PostesRisques },
  { id: 'confidentialite', place: 'droite', Section: Rgpd },
  { id: 'pieces', place: 'droite', Section: Pieces },
  { id: 'hierarchie', place: 'gauche', Section: Hierarchie },
  { id: 'messagerie', place: 'large', Section: Messagerie },
  { id: 'relances', place: 'large', Section: RelancesEcheances },
  { id: 'envois', place: 'large', Section: Envois },
  { id: 'comptes', place: 'large', Section: Comptes },
  { id: 'journal', place: 'large', Section: Journal },
];
