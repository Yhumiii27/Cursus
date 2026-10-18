// Auteur d'une modification concurrente d'une fiche (t108), d'après le journal. Le refus 412 ne nomme une personne que si
// la dernière action du journal qui a pu écrire l'un des champs en conflit concerne bien ce salarié. Si cette action
// touche des fiches sans les nommer (renommage d'un poste du référentiel ou d'une équipe), ou si aucune trace ne
// correspond, le message ne nomme personne : mieux vaut taire l'auteur que de l'attribuer à tort.
import type { ProfilInput } from '../../../shared/rules/profil.ts';
import { PROFIL_FIELDS } from '../../../shared/rules/profil.ts';
import type { Ctx } from './context.ts';

type Champ = keyof ProfilInput;
type Payload = Record<string, unknown> | null;

/** Champs nommés par la ligne du journal d'une modification de fiche (`champsModifies`, server/src/journal.ts). */
const champsModifies = (x: Payload): Champ[] => (Array.isArray(x?.champsModifies) ? x.champsModifies.filter((k): k is Champ => PROFIL_FIELDS.includes(k as Champ)) : []);
/** Colonne `nom` renommée d'après l'ancienne et la nouvelle valeur gardées au journal. */
const renomme = (x: Payload) => !!x?.apres && typeof x.apres === 'object' && Object.hasOwn(x.apres, 'nom');

/** Actions qui écrivent des champs de la fiche d'un salarié nommé au journal (`salaries`), et les champs écrits. */
const ECRIT_LA_FICHE: Record<string, (x: Payload) => readonly Champ[]> = {
  'employe.modifier': champsModifies,
  // Même action, sous le code de la confirmation d'un changement de régime qui ferme le compteur de RTT.
  'employe.rtt': champsModifies,
  'equipe.affecter': () => ['equipe'],
  'employe.sortie': () => ['fin', 'motifSortie'],
  'employe.annulerSortie': () => ['fin', 'motifSortie'],
  'medical.avis': () => ['visite'],
  // Reprise après une absence longue, recalculée à l'écriture de l'absence (server/src/actions/absences.ts, majReprise).
  'absence.saisir': () => ['repriseMotif', 'repriseDate'],
  'absence.qualifier': () => ['repriseMotif', 'repriseDate'],
  'absence.prolonger': () => ['repriseMotif', 'repriseDate'],
  'absence.annuler': () => ['repriseMotif', 'repriseDate'],
  // Imports de la reprise depuis Lucca (écran Mise en service).
  'reprise.salaries': () => PROFIL_FIELDS,
  'reprise.visites': () => ['visite'],
};

/** Actions qui écrivent des champs de fiches sans nommer les salariés au journal : leur auteur n'est jamais nommé. */
const ECRIT_DES_FICHES: Record<string, (x: Payload) => readonly Champ[]> = {
  'referentiel.poste.enregistrer': x => (renomme(x) ? ['poste'] : []),
  'equipe.renommer': () => ['equipe'],
  'equipe.supprimer': () => ['equipe'],
  'equipe.modifier': x => (renomme(x) ? ['equipe'] : []),
};

/** Lignes du journal parcourues, des plus récentes aux plus anciennes. */
const PROFONDEUR = 200;

/**
 * Nom de la personne qui a modifié en dernier l'un des `champs` de la fiche, d'après le journal ; null quand le journal
 * ne permet pas de le dire avec certitude.
 */
export async function dernierAuteurFiche(ctx: Ctx, empId: number, champs: readonly Champ[]): Promise<string | null> {
  const nominatives = Object.keys(ECRIT_LA_FICHE), globales = Object.keys(ECRIT_DES_FICHES);
  const marques = (n: number) => Array(n).fill('?').join(', ');
  const lignes = await ctx.db.query(`SELECT actor, action, payload FROM journal
    WHERE (action IN (${marques(nominatives.length)}) AND EXISTS (SELECT 1 FROM json_each(journal.salaries) WHERE value = ?))
       OR action IN (${marques(globales.length)})
    ORDER BY id DESC LIMIT ${PROFONDEUR}`, [...nominatives, empId, ...globales]) as { actor: string | null; action: string; payload: string | null }[];
  for (const l of lignes) {
    let payload: Payload = null;
    try { payload = l.payload ? JSON.parse(l.payload) as Payload : null; } catch { payload = null; }
    const globale = Object.hasOwn(ECRIT_DES_FICHES, l.action);
    const ecrits = (globale ? ECRIT_DES_FICHES : ECRIT_LA_FICHE)[l.action]?.(payload) ?? [];
    if (!ecrits.some(k => champs.includes(k))) continue;
    return globale ? null : l.actor ?? null;
  }
  return null;
}
