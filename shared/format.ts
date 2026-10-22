// Mise en forme des valeurs affichées (français).
import { parse } from './dates.ts';
import type { ISODate } from './types.ts';

export const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtShort = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
export const fmtIso = (s: ISODate) => fmt(parse(s));
export const fmtIsoShort = (s: ISODate) => fmtShort(parse(s));
export const monthShort = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const rel = (n: number) => n < 0 ? `dépassée depuis ${-n} j` : n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} j`;
export const ini = (nom: string) => nom.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const validiteLabel = (m: number) => m % 12 === 0 ? `${m / 12} an${m >= 24 ? 's' : ''}` : `${m} mois`;
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const key = (s: string | null | undefined) => norm(s || '').replace(/[^a-z0-9]+/g, ' ').trim();
export const plural = (n: number, s: string, p: string) => `${n} ${n > 1 ? p : s}`;
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const fH = (n: number) => `${r1(n).toLocaleString('fr-FR')} h`;
export const fJ = (n: number) => `${r1(n).toLocaleString('fr-FR')} j`;
export const fmtEur = (n: number) => Math.round(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const matricule = (id: number) => `EMP-${String(id).padStart(4, '0')}`;
/** « 7,5 » ou « 7.5 » → 7.5 ; vide ou invalide → 0. */
export const num = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0;
/** Équipe affichée ; un collaborateur sans équipe est « à affecter » par le service RH. */
export const equipeLabel = (e: { equipe: string | null } | null | undefined) => e?.equipe ?? 'À affecter';
/**
 * Texte cherché pour un collaborateur, normalisé (accents et casse ignorés) : nom, poste, équipe, matricule de paie et
 * matricule Cursus (EMP-0001, celui des messages de Keystone). Filtre de Collaborateurs et suggestions de la recherche
 * (client/src/components/recherche.ts).
 */
export const texteRecherche = (e: { id: number; nom: string; poste: string; equipe: string | null; matriculePaie?: string | null }) =>
  norm(`${e.nom} ${e.poste} ${equipeLabel(e)} ${e.matriculePaie ?? ''} ${matricule(e.id)}`);
