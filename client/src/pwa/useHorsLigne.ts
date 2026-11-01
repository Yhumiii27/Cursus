// Saisie hors ligne dans le magasin de l'application (lot 11, chantier C2, t196, étape 2) : un pilote (pwa/pilote.ts)
// par onglet, la file chiffrée de l'appareil (state/hors-ligne.ts, IndexedDB) et les événements du navigateur.
// - État du réseau : navigator.onLine et ses événements ; le bandeau « Hors ligne » le montre.
// - Rejeu : à chaque session lue (chargement, connexion, reconnexion), au retour du réseau et au retour sur l'application
//   (Safari et Firefox n'ont pas de synchronisation en arrière-plan : l'ouverture reste le chemin principal).
// - Déconnexion : notifications de cet appareil désactivées (motif « deconnexion »), puis file purgée une fois la
//   déconnexion faite.
// - Appareil partagé : file purgée et notifications désactivées, plus rien n'est gardé (pwa/appareil.ts).
// - Changement de compte sans déconnexion (session expirée, autre personne) : à chaque session lue, un abonnement aux
//   notifications du navigateur qui n'est pas au compte connecté est retiré (pwa/push.ts, `retirerAbonnementEtranger`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from '../../../shared/types.ts';
import { api, type ActionResponse, type NomAction, type SessionState } from '../api.ts';
import { envoyeurApi, FileHorsLigne, magasinIndexedDb, type EntreeFile } from '../state/hors-ligne.ts';
import { appareilPartage, definirAppareilPartage } from './appareil.ts';
import { PiloteHorsLigne } from './pilote.ts';
import { desactiverNotifications, retirerAbonnementEtranger } from './push.ts';

/** File de l'appareil (une par page), ou null si le navigateur ne peut pas la tenir (IndexedDB, WebCrypto). */
let fileUnique: FileHorsLigne | null | undefined;
export function fileAppareil(): FileHorsLigne | null {
  if (fileUnique === undefined) {
    const possible = typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle && typeof window !== 'undefined' && window.isSecureContext;
    fileUnique = possible ? new FileHorsLigne(magasinIndexedDb()) : null;
  }
  return fileUnique;
}

export interface HorsLigne {
  /** La file peut garder des saisies sur cet appareil. */
  disponible: boolean;
  enLigne: boolean;
  entrees: EntreeFile[];
  /** Saisies gardées dans un autre espace du compte (bandeau ; perdues aussi à la déconnexion). */
  autres: number;
  rejeu: boolean;
  partage: boolean;
  appeler: (name: NomAction, payload: Record<string, unknown>) => Promise<ActionResponse>;
  rejouer: () => Promise<void>;
  /** Relecture périodique : rejeu d'abord tant que des saisies attendent (pwa/pilote.ts, `relecture`). */
  relecture: () => Promise<void>;
  /** Saisies gardées sur l'appareil, tous espaces confondus (alerte avant la déconnexion). */
  taille: () => Promise<number>;
  reprendre: (id: string) => Promise<void>;
  abandonner: (id: string) => Promise<void>;
  /** Avant la déconnexion (session encore valide) : notifications de cet appareil désactivées. */
  avantDeconnexion: () => Promise<void>;
  /** Après la déconnexion : file purgée (une déconnexion refusée faute de réseau ne perd rien). */
  apresDeconnexion: () => Promise<void>;
  definirPartage: (v: boolean) => Promise<void>;
}

const enLigne = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useHorsLigne(dep: {
  session: SessionState | null; sessionRef: { current: SessionState | null }; dataRef: { current: Dataset | null };
  montrer: (d: Dataset) => void; relire: () => Promise<void>; notifier: (t: string, e?: boolean) => void;
}): HorsLigne {
  const [, redessiner] = useState(0);
  const [reseau, setReseau] = useState(enLigne);
  const [partage, setPartage] = useState(appareilPartage);
  const deps = useRef(dep);
  deps.current = dep;
  const partageRef = useRef(partage);
  partageRef.current = partage;
  const pilote = useMemo(() => new PiloteHorsLigne({
    file: fileAppareil(),
    session: () => deps.current.sessionRef.current,
    donnees: () => deps.current.dataRef.current,
    montrer: d => deps.current.montrer(d),
    appelerApi: (n, p, espace, rejeu) => api.action(n, p, espace, rejeu),
    envoyeur: envoyeurApi,
    relire: () => deps.current.relire(),
    notifier: (t, e) => deps.current.notifier(t, e),
    enLigne,
    partage: () => partageRef.current,
    verifierAbonnement: () => retirerAbonnementEtranger(),
    changement: () => redessiner(n => n + 1),
  }), []);

  // Session lue : purges (autre compte, 7 jours) et rejeu.
  const { session } = dep;
  useEffect(() => { void pilote.surSession(); }, [pilote, session]);
  useEffect(() => {
    const enLigneMaintenant = () => { setReseau(true); void pilote.rejouer(); };
    const horsLigne = () => setReseau(false);
    const retour = () => { if (document.visibilityState === 'visible') void pilote.rejouer(); };
    addEventListener('online', enLigneMaintenant);
    addEventListener('offline', horsLigne);
    document.addEventListener('visibilitychange', retour);
    return () => {
      removeEventListener('online', enLigneMaintenant);
      removeEventListener('offline', horsLigne);
      document.removeEventListener('visibilitychange', retour);
    };
  }, [pilote]);

  const lancer = useCallback((n: NomAction, p: Record<string, unknown>) => api.action(n, p, deps.current.sessionRef.current?.role), []);
  const avantDeconnexion = useCallback(async () => { await desactiverNotifications(lancer, 'deconnexion').catch(() => null); }, [lancer]);
  const apresDeconnexion = useCallback(async () => { await pilote.purger(); }, [pilote]);
  const definirPartage = useCallback(async (v: boolean) => {
    definirAppareilPartage(v);
    setPartage(v);
    if (v) {
      await desactiverNotifications(lancer, 'utilisateur').catch(() => null);
      await pilote.purger();
    }
  }, [lancer, pilote]);

  return {
    disponible: !!fileAppareil() && !partage, enLigne: reseau, entrees: pilote.entrees, autres: pilote.autres, rejeu: pilote.rejeu, partage,
    appeler: (n, p) => pilote.appeler(n, p),
    rejouer: async () => { await pilote.rejouer(); },
    relecture: () => pilote.relecture(),
    taille: () => pilote.taille(),
    reprendre: id => pilote.reprendre(id),
    abandonner: id => pilote.abandonner(id),
    avantDeconnexion, apresDeconnexion, definirPartage,
  };
}
