// Géolocalisation au pointage (lot 12, chantier C6, étape 3, t191) : règles pures, communes au serveur
// (server/src/actions/pointage.ts, server/src/geolocalisation.ts) et à l'interface (bouton « Pointer », Paramètres →
// Badgeage). Option livrée désactivée (réglage `geolocActive`), à n'activer qu'après l'avis du CSE, l'analyse d'impact
// (AIPD) validée par le DPO et l'information des salariés.
// - Licéité (Cass. soc. 3 nov. 2011, n° 10-18.036 ; CE 15 déc. 2017, n° 403776) : la géolocalisation ne sert au contrôle
//   de la durée du travail que si aucun autre moyen n'est possible. Elle est donc réservée à des populations désignées
//   (`geolocPopulations` : équipes itinérantes de chantier, sans moyen de pointer sur place), qui pointent par ailleurs
//   (population badgée en vigueur) ; jamais en continu, jamais hors ligne.
// - Position demandée au seul clic sur « Pointer » (une lecture, jamais de suivi) ; le serveur en tire un verdict
//   (`verdictZone` : dans la zone, hors zone, précision insuffisante, refusée) et jette les coordonnées : seul le verdict
//   est gardé sur le pointage (`pointages.zone`).
// - Un refus de partager sa position n'empêche jamais de pointer : le pointage est enregistré, le verdict « refusée » ne
//   produit qu'une anomalie « position non vérifiée », au même texte qu'une position imprécise (aucune sanction ne peut
//   s'appuyer sur le refus, et le manager ne distingue pas les deux).
// - Le manager ne lit que « dans la zone » ou « hors zone » (`verdictPourLecteur`) ; le salarié et le service RH lisent le
//   verdict entier.
import type { CriterePopulation, Employe, ISODate, PopulationGeoloc, Settings, VerdictZone, ZonePointage } from '../types.ts';
import { type ContextePopulation, dansLaPopulation, estCritere, pointeAu, POPULATIONS_MAX, VALEUR_POPULATION_MAX } from './pointage.ts';

// — Constantes —

/** Précision exigée de la position (réglage `geolocPrecisionM`, en mètres) : 100 m par défaut, de 20 m à 1 000 m. */
export const PRECISION_DEFAUT_M = 100;
export const PRECISION_MIN_M = 20;
export const PRECISION_MAX_M = 1000;
/** Rayon d'une zone (mètres), comme la contrainte `zones_pointage_rayon_check` de la migration 0027. */
export const RAYON_MIN_M = 10;
export const RAYON_MAX_M = 10_000;
/** Libellé d'une zone, finalité écrite : textes bornés. */
export const LIBELLE_ZONE_MAX = 80;
export const FINALITE_MAX = 400;
/** Zones tenues au plus (une par site ou chantier). */
export const ZONES_MAX = 200;
/** Délai donné au navigateur pour lire la position, en millisecondes : au-delà, le pointage part sans elle. */
export const DELAI_POSITION_MS = 10_000;
/** Rayon moyen de la Terre (mètres), pour la distance de haversine. */
const RAYON_TERRE_M = 6_371_008.8;

export const VERDICTS_ZONE: Record<VerdictZone, string> = {
  dans: 'Dans la zone',
  hors: 'Hors zone',
  imprecise: 'Position imprécise',
  refusee: 'Position non partagée',
};
/** Ce que lit le manager : « dans » ou « hors » ; une position imprécise ou non partagée se lit « non vérifiée ». */
export const VERDICT_NON_VERIFIE = 'Position non vérifiée';

// — Position reçue —

/** Position lue par le navigateur au clic : degrés décimaux WGS 84 et précision (rayon d'incertitude, mètres). */
export interface PositionPointage { lat: number; lng: number; precision: number }
/** Ce que l'interface envoie : la position, ou le refus du salarié, ou une position impossible à lire (délai, appareil). */
export type PositionRecue = PositionPointage | 'refusee' | 'indisponible';

const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Position reçue avec un pointage : objet { lat, lng, precision } aux bornes, ou « refusee » / « indisponible » ; absente :
 * null ; illisible : { refus } (message).
 */
export function lirePosition(v: unknown): PositionRecue | null | { refus: string } {
  if (v == null) return null;
  if (v === 'refusee' || v === 'indisponible') return v;
  if (typeof v !== 'object') return { refus: 'Position illisible' };
  const o = v as Record<string, unknown>, lat = nombre(o.lat), lng = nombre(o.lng), precision = nombre(o.precision);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { refus: 'Position illisible (latitude et longitude en degrés décimaux attendues)' };
  if (precision == null || precision < 0) return { refus: 'Position illisible (précision en mètres attendue)' };
  return { lat, lng, precision };
}

/** Distance entre deux points (mètres), formule de haversine sur une Terre sphérique : juste à quelques mètres près. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Verdict d'une position au regard des zones actives :
 * - aucune position (refus du salarié, ou rien reçu) : « refusee » ; position impossible à lire : « imprecise » ;
 * - tout le cercle d'incertitude dans une zone active : « dans », quelle que soit la précision (aucun doute) ;
 * - précision plus large que `precisionMaxM` : « imprecise » ;
 * - centre de la position dans le cercle d'une zone active : « dans » ;
 * - hors de toute zone, mais le cercle d'incertitude en touche une : « imprecise » (le doute profite au salarié) ;
 * - sinon (ou aucune zone active) : « hors ».
 * Seul ce verdict est gardé ; la position n'est jamais écrite.
 */
export function verdictZone(pos: PositionRecue | null, zones: readonly Pick<ZonePointage, 'lat' | 'lng' | 'rayonM' | 'actif'>[], precisionMaxM: number): VerdictZone {
  if (pos == null || pos === 'refusee') return 'refusee';
  if (pos === 'indisponible') return 'imprecise';
  const actives = zones.filter(z => z.actif);
  if (actives.some(z => distanceM(pos, z) + pos.precision <= z.rayonM)) return 'dans';
  if (pos.precision > precisionMaxM) return 'imprecise';
  if (actives.some(z => distanceM(pos, z) <= z.rayonM)) return 'dans';
  if (actives.some(z => distanceM(pos, z) - pos.precision <= z.rayonM)) return 'imprecise';
  return 'hors';
}

/**
 * Verdict tel qu'un lecteur le voit : le salarié et le service RH (`detail`) le lisent entier ; le manager seulement
 * « dans » ou « hors » (null : position imprécise ou non partagée, sans distinction : un refus ne se lit pas).
 */
export function verdictPourLecteur(v: VerdictZone | null, detail: boolean): VerdictZone | null {
  if (v == null || detail) return v;
  return v === 'dans' || v === 'hors' ? v : null;
}

// — Populations et activation —

/** Contexte de la géolocalisation : celui des populations badgées, plus les réglages de l'option. */
export interface ContexteGeoloc extends ContextePopulation {
  settings: ContextePopulation['settings'] & Pick<Settings, 'geolocActive' | 'geolocPopulations'>;
}

/**
 * La position est-elle demandée à ce salarié le `date` ? Option active, salarié qui pointe ce jour-là (population badgée
 * en vigueur, exclusions comprises) et désigné par une population de la géolocalisation. Jamais hors de ces populations :
 * qui peut pointer sur place n'est pas géolocalisé.
 */
export function geolocAu(x: ContexteGeoloc, e: Pick<Employe, 'equipe' | 'temps' | 'typeContrat'>, date: ISODate): boolean {
  if (!x.settings.geolocActive || !pointeAu(x, e, date)) return false;
  return (x.settings.geolocPopulations ?? []).some(p => dansLaPopulation(x, e, { ...p, mode: 'controle', effet: date }));
}

/** Populations de la géolocalisation saisies dans Paramètres : { critere, valeur } ; refus (message) d'une entrée invalide. */
export function lirePopulationsGeoloc(v: unknown): PopulationGeoloc[] | string {
  if (!Array.isArray(v)) return 'Géolocalisation : liste des populations attendue';
  if (v.length > POPULATIONS_MAX) return `Géolocalisation : ${POPULATIONS_MAX} populations au plus`;
  const out: PopulationGeoloc[] = [];
  for (const [i, x] of v.entries()) {
    const n = `Géolocalisation, population ${i + 1}`;
    if (!x || typeof x !== 'object') return `${n} : incomplète`;
    const critere = (x as Record<string, unknown>).critere as CriterePopulation;
    const brute = (x as Record<string, unknown>).valeur, valeur = typeof brute === 'string' ? brute.trim() : '';
    if (!estCritere(critere)) return `${n} : critère inconnu`;
    if (!valeur || valeur.length > VALEUR_POPULATION_MAX) return `${n} : valeur requise (${VALEUR_POPULATION_MAX} caractères au plus)`;
    if (out.some(p => p.critere === critere && p.valeur === valeur)) return `${n} : en double`;
    out.push({ critere, valeur });
  }
  return out;
}

/**
 * Refus de l'activation de la géolocalisation, sinon null (COHERENCE de shared/reglages.ts) : badgeage actif, finalité
 * écrite, date de l'analyse d'impact (AIPD) validée par le DPO et au moins une population.
 */
export function refusActivationGeoloc(s: Pick<Settings, 'geolocActive' | 'geolocFinalite' | 'geolocAipdLe' | 'geolocPopulations' | 'pointageActif'>): string | null {
  if (!s.geolocActive) return null;
  if (!s.pointageActif) return 'Géolocalisation : elle ne s’active qu’avec le badgeage';
  if (!s.geolocFinalite?.trim()) return 'Géolocalisation : écrivez sa finalité (pourquoi aucun autre moyen de pointer n’est possible pour ces salariés)';
  if (!s.geolocAipdLe) return 'Géolocalisation : indiquez la date de l’analyse d’impact (AIPD) validée par le DPO';
  if (!(s.geolocPopulations ?? []).length) return 'Géolocalisation : désignez au moins une population (équipes itinérantes sans autre moyen de pointer)';
  return null;
}

// — Zones —

/** Zone saisie (sans identifiant) : contrôle des champs ; refus (message) sinon. */
export function lireZone(v: Record<string, unknown>): Omit<ZonePointage, 'id'> | string {
  const libelle = typeof v.libelle === 'string' ? v.libelle.trim() : '';
  if (!libelle || libelle.length > LIBELLE_ZONE_MAX) return `Libellé de la zone requis (${LIBELLE_ZONE_MAX} caractères au plus)`;
  const lat = Number(v.lat), lng = Number(v.lng), rayonM = Number(v.rayonM);
  if (v.lat === '' || v.lat == null || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude du centre : de −90 à 90 degrés décimaux';
  if (v.lng === '' || v.lng == null || !Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude du centre : de −180 à 180 degrés décimaux';
  if (!Number.isInteger(rayonM) || rayonM < RAYON_MIN_M || rayonM > RAYON_MAX_M) return `Rayon : de ${RAYON_MIN_M} à ${RAYON_MAX_M} mètres, nombre entier`;
  const code = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 40) : null);
  return { libelle, siteCode: code(v.siteCode), chantierId: code(v.chantierId), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, rayonM, actif: v.actif !== false };
}
