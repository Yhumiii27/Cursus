// Paramètres de suivi et réinitialisation de la démonstration.
import type { Settings } from '../../../shared/types.ts';
import { DEMO } from '../auth.ts';
import { loadSettings } from '../dataset.ts';
import { seedDemo } from '../seed.ts';
import { ActionError, requireRh, type ActionHandler } from './context.ts';

const clamp = (v: unknown, min: number, max: number, step = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n / step) * step));
};

const maj: ActionHandler = (ctx, p) => {
  requireRh(ctx);
  const cur = loadSettings(ctx.db);
  const next: Settings = { ...cur };
  if (p.horizonAlerte !== undefined) next.horizonAlerte = clamp(p.horizonAlerte, 30, 180, 30) ?? cur.horizonAlerte;
  if (p.seuilBudget !== undefined) next.seuilBudget = clamp(p.seuilBudget, 60, 100, 5) ?? cur.seuilBudget;
  if (p.rtt39 !== undefined) next.rtt39 = clamp(p.rtt39, 0, 40) ?? cur.rtt39;
  if (p.uniquementReglementaire !== undefined) next.uniquementReglementaire = !!p.uniquementReglementaire;
  if (p.partageKeystone !== undefined) next.partageKeystone = p.partageKeystone === 'detaille' ? 'detaille' : 'minimal';
  if (typeof p.rhNom === 'string' && p.rhNom.trim()) next.rhNom = p.rhNom.trim();
  ctx.db.setSetting('app', next);
  return p.silent ? null : 'Paramètres enregistrés';
};

const reinitialiser: ActionHandler = (ctx) => {
  requireRh(ctx);
  if (!DEMO) throw new ActionError('Réinitialisation disponible uniquement en mode démonstration', 403);
  seedDemo(ctx.db);
  return 'Données de démonstration réinitialisées';
};

export const parametresActions: Record<string, ActionHandler> = {
  'parametres.maj': maj,
  'demo.reinitialiser': reinitialiser,
};
