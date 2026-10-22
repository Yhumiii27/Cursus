// Passeport formation imprimé (t115) : sections communes à la fiche du collaborateur (service RH, manager, référent HSE)
// et au portail du salarié (« Imprimer mon passeport formation »). Certifications en vigueur et remplacées, habilitations
// et délivrances antérieures, formations suivies (t116). Le motif d'une suspension ou d'un retrait n'est jamais imprimé :
// seuls l'état et sa date figurent. L'impression est tracée au journal (`POST /api/exports`, client/src/print.ts).
import { CERT_LABEL, HAB_LABEL } from '../../shared/constants.ts';
import { parse } from '../../shared/dates.ts';
import type { Domain, EmpX } from '../../shared/domain.ts';
import { equipeLabel, fH, fmt } from '../../shared/format.ts';
import { heuresSuivie, intituleSuivie, ORIGINE_SUIVIE_LABEL, suiviesEnVigueur } from '../../shared/rules/formations-suivies.ts';
import type { HabDelivrance } from '../../shared/types.ts';
import { matriculesImprimes, printDocument, type PrintSection } from './print.ts';

const date = (j: string | null | undefined) => (j ? fmt(parse(j)) : '—');

/** Délivrances remplacées d'un salarié (habilitations antérieures), plus récentes d'abord. */
export function delivrancesAnterieures(d: Domain, empId: number): HabDelivrance[] {
  return (d.ds.habDelivrances ?? []).filter(x => x.empId === empId && x.remplaceeLe)
    .sort((a, b) => b.delivree.localeCompare(a.delivree) || b.id - a.id);
}

/** Mesure figée au remplacement d'une délivrance : « Suspendue le 3 mars 2025 », sans motif. */
export const mesureFigee = (x: Pick<HabDelivrance, 'mesure' | 'mesureDate'>) =>
  x.mesure ? `${x.mesure === 'retrait' ? 'Retirée' : 'Suspendue'}${x.mesureDate ? ` le ${date(x.mesureDate)}` : ''}` : '';

/** Sections du passeport formation d'un salarié. */
export function sectionsPasseport(d: Domain, e: EmpX): PrintSection[] {
  const anterieures = delivrancesAnterieures(d, e.id);
  const suivies = suiviesEnVigueur(d.ds, e.id).sort((a, b) => b.du.localeCompare(a.du));
  return [
    { title: 'Certifications', table: { head: ['Formation', 'Obtenue le', 'Expire le', 'Statut'], rows: e.rawCerts.map(c => [c.fm.nom, fmt(c.obt), fmt(c.exp), CERT_LABEL[c.key]]) } },
    ...(e.anciennes.length ? [{ title: 'Certifications remplacées', table: { head: ['Formation', 'Obtenue le', 'Expirait le', 'Remplacée le'], rows: e.anciennes.map(c => [c.fm.nom, fmt(c.obt), fmt(c.exp), fmt(c.remplacee!)]) } }] : []),
    // Le motif d'une suspension ou d'un retrait n'est pas imprimé : seuls l'état et sa date figurent au passeport.
    ...(e.habs.length ? [{ title: 'Habilitations', table: { head: ['Habilitation', 'Délivrée le', 'Par', 'Expire le', 'Statut'], rows: e.habs.map(h => [h.hm.nom, h.delivree ? date(h.delivree) : '—', h.par ?? '—', h.exp ? fmt(h.exp) : '—', HAB_LABEL[h.key] + (h.mesureLe ? ` le ${fmt(h.mesureLe)}` : '')]) } }] : []),
    ...(anterieures.length ? [{
      title: 'Habilitations antérieures',
      table: {
        head: ['Habilitation', 'Délivrée le', 'Par', 'Expirait le', 'Remplacée le', 'Mesure'],
        rows: anterieures.map(x => [d.hm(x.h)?.nom ?? x.h, date(x.delivree), x.par ?? '—', date(x.expire), date(x.remplaceeLe), mesureFigee(x) || '—']),
      },
    }] : []),
    ...(suivies.length ? [{
      title: 'Formations suivies',
      table: {
        head: ['Formation', 'Du', 'Au', 'Durée', 'Organisme', 'Obligatoire', 'Origine'],
        rows: suivies.map(x => {
          const h = heuresSuivie(d, x);
          return [intituleSuivie(d, x), date(x.du), date(x.au), h == null ? 'inconnue' : fH(h), x.organisme ?? (x.f ? d.fm(x.f)?.organisme ?? '' : ''), x.obligatoire ? 'Oui' : 'Non', ORIGINE_SUIVIE_LABEL[x.origine]];
        }),
      },
    }] : []),
  ];
}

/** Imprime le passeport formation ; faux si rien n'a pu s'ouvrir (fenêtres surgissantes bloquées). */
export function imprimerPasseport(d: Domain, e: EmpX): boolean {
  return printDocument(`Passeport formation — ${e.nom}`, `${e.poste} · ${equipeLabel(e)}`, sectionsPasseport(d, e), e.id, matriculesImprimes(e));
}
