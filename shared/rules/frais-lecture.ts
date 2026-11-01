// Lecture d'un reçu collé (lot 11, chantier C5) : le salarié copie le texte de la photo de son reçu avec l'outil de son
// téléphone (Live Text sur iOS, Google Lens sur Android) et le colle dans Cursus ; cette règle, sans dépendance ni service
// externe (réponse du propriétaire du 31 octobre 2026), en propose le montant total, la date, la devise, les taux et
// montants de TVA, le SIRET et le nom du commerçant. Ce ne sont que des propositions : le salarié confirme chaque champ.
// Rien n'est envoyé ailleurs ; le texte collé n'est ni stocké ni journalisé.
import { isValidDate } from '../dates.ts';
import type { ISODate } from '../types.ts';
import { r2 } from './frais.ts';

/** Propositions tirées du texte d'un reçu ; un champ absent n'a pas été reconnu. */
export interface LectureRecu {
  montant?: number;
  date?: ISODate;
  devise?: string;
  tva?: { taux: number; montant: number | null }[];
  siret?: string;
  commercant?: string;
}

/** Longueur au plus du texte lu (un reçu tient en quelques centaines de caractères). */
export const TEXTE_RECU_MAX = 5000;

/** Montant écrit à la française ou à l'anglaise (« 1 234,56 », « 1234.56 », « 12,5 ») ; null s'il n'en est pas un. */
export function montantLu(t: string): number | null {
  const s = t.replace(/[\s  ]/g, '');
  const m = /^-?(\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const entier = m[1].replace(/[.,]/g, '');
  const n = Number(`${entier}.${m[2] ?? '0'}`);
  return Number.isFinite(n) ? r2(n) : null;
}

const NOMBRE = String.raw`\d{1,3}(?:[   .,]\d{3})*(?:[.,]\d{1,2})|\d+(?:[.,]\d{1,2})?`;
const DEVISES: [RegExp, string][] = [[/€|\bEUR\b|\beuros?\b/i, 'EUR'], [/\$|\bUSD\b/, 'USD'], [/£|\bGBP\b/, 'GBP'], [/\bCHF\b/, 'CHF'], [/\bMAD\b|\bdirhams?\b/i, 'MAD']];
/** Mots qui annoncent le total payé, du plus sûr au moins sûr. */
const TOTAUX = [/net\s*[àa]\s*payer/i, /total\s*t\.?t\.?c\.?/i, /montant\s*t\.?t\.?c\.?/i, /\btotal\b/i, /\bt\.?t\.?c\.?\b/i, /\bmontant\b/i, /\bà\s*payer\b/i];
/** Lignes qui ne nomment pas le commerçant. */
const PAS_COMMERCANT = /total|ticket|facture|re[çc]u|tva|siret|siren|date|carte|cb\b|merci|tel|t[ée]l[ée]phone|www\.|@|\d{2}[/.-]\d{2}/i;

/** Date d'un reçu : JJ/MM/AAAA, JJ/MM/AA, JJ-MM-AAAA, JJ.MM.AAAA ou AAAA-MM-JJ ; la première date valide. */
export function dateLue(texte: string): ISODate | undefined {
  for (const m of texte.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g)) {
    const [a, mo, j] = m[1] ? [m[1], m[2], m[3]] : [m[6].length === 2 ? `20${m[6]}` : m[6], m[5].padStart(2, '0'), m[4].padStart(2, '0')];
    const d = `${a}-${mo}-${j}`;
    if (isValidDate(d)) return d;
  }
  return undefined;
}

/** Propositions tirées du texte collé d'un reçu (au plus TEXTE_RECU_MAX caractères lus). */
export function lireRecu(texteColle: string): LectureRecu {
  const texte = String(texteColle ?? '').slice(0, TEXTE_RECU_MAX);
  const lignes = texte.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: LectureRecu = {};
  // Montant : la dernière ligne qui annonce le total, mot par mot du plus sûr ; à défaut, le plus grand montant lu.
  const montantsDe = (l: string) => [...l.matchAll(new RegExp(NOMBRE, 'g'))].map(m => montantLu(m[0])).filter((n): n is number => n !== null);
  for (const mot of TOTAUX) {
    const l = [...lignes].reverse().find(x => mot.test(x) && !/tva|ht\b|hors\s*taxe/i.test(x.replace(mot, '')));
    const n = l ? montantsDe(l.replace(mot, ' ')).at(-1) : undefined;
    if (n !== undefined && n > 0) { out.montant = n; break; }
  }
  if (out.montant === undefined) {
    const tous = lignes.filter(l => !/%|siret|siren|t[ée]l/i.test(l)).flatMap(l => montantsDe(l)).filter(n => n > 0 && n < 100000);
    if (tous.length) out.montant = Math.max(...tous);
  }
  const date = dateLue(texte);
  if (date) out.date = date;
  const devise = DEVISES.find(([re]) => re.test(texte));
  if (devise) out.devise = devise[1];
  // TVA : « TVA 10 % 1,23 », « 20,00% … 4,17 » ; un taux par ligne, montant facultatif.
  const tva: { taux: number; montant: number | null }[] = [];
  for (const l of lignes) {
    if (!/tva|t\.v\.a|vat/i.test(l) && !/%/.test(l)) continue;
    const t = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/.exec(l);
    if (!t) continue;
    const taux = montantLu(t[1]);
    if (taux === null || ![20, 10, 5.5, 2.1].includes(taux)) continue;
    const apres = l.slice((t.index ?? 0) + t[0].length);
    const montant = [...apres.matchAll(new RegExp(NOMBRE, 'g'))].map(m => montantLu(m[0])).filter((n): n is number => n !== null).at(-1) ?? null;
    if (!tva.some(x => x.taux === taux)) tva.push({ taux, montant });
  }
  if (tva.length) out.tva = tva;
  const siret = /(?:siret|siren)?\D{0,12}(\d{3}[  ]?\d{3}[  ]?\d{3}[  ]?\d{5})\b/i.exec(texte);
  if (siret) out.siret = siret[1].replace(/\D/g, '');
  // Commerçant : première ligne qui a des lettres et n'est ni un total, ni une date, ni une coordonnée.
  const nom = lignes.find(l => /\p{L}{3,}/u.test(l) && !PAS_COMMERCANT.test(l) && l.replace(/[^\d]/g, '').length < l.length / 2);
  if (nom) out.commercant = nom.replace(/\s+/g, ' ').slice(0, 80);
  return out;
}
