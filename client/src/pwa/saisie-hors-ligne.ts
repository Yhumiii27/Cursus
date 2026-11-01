// Saisie gardée pendant une coupure du réseau (lot 11, chantier C2, t196) : règles pures, sans React ni navigateur
// (tests/client-pwa.test.ts). La file chiffrée (state/hors-ligne.ts) garde la saisie ; ce module dit ce qui y entre, sous
// quelle forme, et comment l'écran la montre en attendant l'envoi.
// - Seulement la saisie personnelle de l'application déjà ouverte (réponse du propriétaire du 31 octobre 2026) : les
//   heures de sa propre feuille, une ligne de projet ajoutée, une demande de congé (CP, RTT, récupération) ; jamais une
//   validation, une action de paie, ni une saisie pour un autre salarié (contrôlé de nouveau par le serveur : refusHorsLigne).
// - La cellule d'heures n'est jamais désignée par son indice de ligne, qui peut changer avant l'envoi : temps.setCell
//   devient temps.saisir (projet, tâche, jour, valeur vue `base`), qui refuse en conflit au lieu d'écraser.
// - En attendant l'envoi, la feuille affichée porte la saisie (instantané en mémoire seulement, jamais gardé sur
//   l'appareil) ; une demande de congé n'est pas décomptée du solde : elle apparaît « en attente d'envoi ».
import { ABS_LABEL } from '../../../shared/constants.ts';
import { addD, parse } from '../../../shared/dates.ts';
import { fH, fmtIso, num } from '../../../shared/format.ts';
import { CONGES_HORS_LIGNE, refusHorsLigne } from '../../../shared/hors-ligne.ts';
import type { AbsenceType, CategorieFrais, Dataset, FeuilleTemps, ISODate } from '../../../shared/types.ts';
// lot 11 — notes de frais
import { CATEGORIES_FRAIS } from '../../../shared/rules/frais.ts';
import type { NomAction } from '../api.ts';
import { cellValue } from '../components/heures.ts';

/** Saisie telle qu'elle entre dans la file : action du registre hors ligne et ses paramètres. */
export interface MiseEnFile { nom: NomAction; payload: Record<string, unknown> }

const feuilleDe = (data: Dataset, empId: number, week: unknown) => data.feuilles.find(f => f.empId === empId && f.week === week);
const heures = (h: readonly number[], di: number) => num(h[di]);

/**
 * Forme hors ligne d'une action lancée par l'écran, ou null si elle ne peut pas attendre le réseau (elle échoue alors
 * comme avant, avec le message « Connexion au serveur impossible »).
 */
export function versFile(nom: NomAction, payload: Record<string, unknown>, data: Dataset | null): MiseEnFile | null {
  const empId = data?.user.empId ?? null;
  if (!data || empId == null || Number(payload.empId) !== empId) return null;
  let mf: MiseEnFile | null = null;
  if (nom === 'temps.setCell') {
    const l = feuilleDe(data, empId, payload.week)?.lignes[Number(payload.li)];
    const di = Number(payload.di);
    if (l) mf = { nom: 'temps.saisir', payload: { empId, week: payload.week, projet: l.projet, tache: l.tache, di, value: String(payload.value ?? ''), base: String(heures(l.h, di)) } };
  } else if (nom === 'temps.saisir') mf = { nom, payload };
  else if (nom === 'temps.addLine') mf = { nom, payload: { ...payload, siAbsente: true } };
  else if (nom === 'absence.demander' && CONGES_HORS_LIGNE.includes(String(payload.kind))) mf = { nom, payload };
  // lot 11 — notes de frais : dépense sans photo (indemnité kilométrique, attestation) ; avec photo, l'écran la garde
  // lui-même avec sa pièce (pilote.ts, `garderAvecPieces`). Jamais de frais médicaux (refusHorsLigne).
  else if (nom === 'frais.ligne.ajouter' && !payload.jetons) mf = { nom, payload };
  return mf && refusHorsLigne(mf.nom, mf.payload, empId) === null ? mf : null;
}

/**
 * Instantané en mémoire qui montre la saisie mise en file (heures, ligne ajoutée) ; inchangé pour une demande de congé
 * (aucun décompte local du solde) ou une saisie qui ne s'applique pas (feuille absente).
 */
export function appliquerLocalement(data: Dataset, mf: MiseEnFile): Dataset {
  const p = mf.payload, empId = Number(p.empId);
  const sh = feuilleDe(data, empId, p.week);
  const remplacer = (f: FeuilleTemps): Dataset => ({ ...data, feuilles: sh ? data.feuilles.map(x => x === sh ? f : x) : [...data.feuilles, f] });
  if (mf.nom === 'temps.saisir' && sh) {
    const di = Number(p.di);
    const li = sh.lignes.findIndex(l => l.projet === p.projet && (!p.tache || l.tache === p.tache));
    if (li < 0) return data;
    return remplacer({ ...sh, lignes: sh.lignes.map((l, i) => i === li ? { ...l, h: Array.from({ length: Math.max(7, l.h.length) }, (_, j) => j === di ? cellValue(String(p.value)) : heures(l.h, j)) } : l) });
  }
  if (mf.nom === 'temps.addLine') {
    const projet = String(p.projet ?? '');
    if (sh?.lignes.some(l => l.projet === projet)) return data;
    const pr = data.referentiels.projets.find(x => x.code === projet);
    if (!pr) return data;
    const ligne = { projet, tache: pr.nom, ks: false, h: [0, 0, 0, 0, 0, 0, 0] };
    // Feuille pas encore créée sur le serveur : créée en mémoire seulement (identifiant négatif), comme le fera l'envoi.
    return remplacer(sh ? { ...sh, lignes: [...sh.lignes, ligne] }
      : { id: -1, empId, week: String(p.week) as ISODate, statut: 'brouillon', comment: null, sage: false, keystone: false, lignes: [ligne], contrat: null });
  }
  return data;
}

const jour = (week: unknown, di: unknown) => parse(addD(String(week) as ISODate, Number(di))).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Libellé d'une saisie en file (« Heures · INT-MAINT · lundi 12 octobre : 7 h »), sans rien d'autre que la saisie. */
export function libelleSaisie(nom: string, p: Record<string, unknown>): string {
  if (nom === 'temps.saisir') return `Heures · ${String(p.projet)} · ${jour(p.week, p.di)} : ${fH(cellValue(String(p.value ?? '')))}`;
  if (nom === 'temps.addLine') return `Ligne ${String(p.projet)} ajoutée · semaine du ${fmtIso(String(p.week) as ISODate)}`;
  if (nom === 'absence.demander') {
    const nature = ABS_LABEL[String(p.kind) as AbsenceType] ?? 'Congé';
    return p.du === p.au ? `${nature} · le ${fmtIso(String(p.du) as ISODate)}` : `${nature} · du ${fmtIso(String(p.du) as ISODate)} au ${fmtIso(String(p.au) as ISODate)}`;
  }
  // lot 11 — notes de frais : catégorie, date et montant saisis, rien d'autre (ni commerçant, ni invités).
  if (nom === 'frais.ligne.ajouter') {
    const c = CATEGORIES_FRAIS[String(p.categorie) as CategorieFrais]?.label ?? 'Dépense';
    const m = Number(String(p.montant ?? '').replace(',', '.'));
    return `Dépense · ${c} · le ${fmtIso(String(p.date) as ISODate)}${m > 0 ? ` : ${m.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(p.devise ?? 'EUR') === 'EUR' ? '€' : String(p.devise)}` : ''}`;
  }
  return 'Saisie';
}

/**
 * Boutons proposés pour une saisie de la file (components/FileEnAttente.tsx) : « Abandonner » toujours ; « Renvoyer » pour
 * un refus qui peut disparaître (solde, feuille rouverte) ; jamais pour un conflit de cellule, refusé de nouveau à
 * coup sûr avec la même valeur de base : « Ouvrir la feuille » pour y ressaisir.
 */
export function boutonsSaisie(e: { etat: 'attente' | 'a_reprendre'; conflit?: boolean }): ('renvoyer' | 'feuille' | 'abandonner')[] {
  if (e.etat !== 'a_reprendre') return ['abandonner'];
  return e.conflit ? ['feuille', 'abandonner'] : ['renvoyer', 'abandonner'];
}
