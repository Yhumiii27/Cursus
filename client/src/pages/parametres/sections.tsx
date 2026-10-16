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
import { Conges } from './Conges.tsx';
import { Contrats } from './Contrats.tsx';
import { Demonstration } from './Demonstration.tsx';
import { Entretiens } from './Entretiens.tsx';
import { Envois } from './Envois.tsx';
import { Keystone } from './Keystone.tsx';
import { MatriculesPaie } from './MatriculesPaie.tsx';
import { ReglagesPaie } from './ReglagesPaie.tsx';
import { Rgpd } from './Rgpd.tsx';
import { SagePaie } from './SagePaie.tsx';
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
  { id: 'demonstration', place: 'gauche', Section: Demonstration },
  { id: 'keystone', place: 'droite', Section: Keystone },
  { id: 'sage', place: 'droite', Section: SagePaie },
  { id: 'matricules', place: 'droite', Section: MatriculesPaie },
  { id: 'conges', place: 'gauche', Section: Conges },
  { id: 'contrats', place: 'gauche', Section: Contrats },
  { id: 'paie', place: 'droite', Section: ReglagesPaie },
  { id: 'confidentialite', place: 'droite', Section: Rgpd },
  { id: 'messagerie', place: 'large', Section: Messagerie },
  { id: 'envois', place: 'large', Section: Envois },
  { id: 'comptes', place: 'large', Section: Comptes },
  { id: 'journal', place: 'large', Section: Journal },
];
