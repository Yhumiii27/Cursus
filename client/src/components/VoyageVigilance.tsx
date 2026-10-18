// Dossier voyage (écran Voyages, service RH) : vigilance du pays de destination (France Diplomatie, t068) et rappel de
// la vérifier avant le départ, coordonnées sur place (hébergement, contact local, inscription sur Ariane) et ce que le
// déplacement donnera à la paie (t031 : jours à l'étranger et trajets, shared/rules/deplacements-paie.ts).
import { fmtIso, plural } from '../../../shared/format.ts';
import { partsSejour } from '../../../shared/rules/deplacements-paie.ts';
import { rappelVigilance, VIGILANCES, vigilanceTexte } from '../../../shared/rules/vigilance.ts';
import type { Voyage } from '../../../shared/types.ts';
import { useDomain } from '../state/derived.ts';
import { Fine, NoteAccent, Tag } from './ui.tsx';

export function VoyageVigilance({ t }: { t: Voyage }) {
  const d = useDomain();
  const dest = d.destOf(t.dest);
  const rappel = rappelVigilance(dest, t, d.ti, d.ds.settings.vigilanceRappelJours);
  const parts = partsSejour(d, { source: 'voyage', id: t.id, empId: t.empId, du: t.depart, au: t.retour, pays: t.dest }, '9999-12');
  const jours = parts.filter(p => p.rubrique === 'ETR_JOUR').reduce((n, p) => n + p.quantite, 0);
  const trajets = parts.filter(p => p.rubrique === 'TRAJET').reduce((n, p) => n + p.quantite, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {dest?.vigilance ? <Tag cls={VIGILANCES[dest.vigilance].cls}>{`Vigilance ${dest.vigilance}`}</Tag> : <Tag cls="tag-outline">Vigilance non renseignée</Tag>}
        {dest?.vigilance && <span className="text-muted sub">{vigilanceTexte(dest.vigilance)}{dest.vigilanceLe ? ` · vérifiée le ${fmtIso(dest.vigilanceLe)}` : ''}</span>}
      </div>
      {dest?.vigilance === 'rouge' && <NoteAccent>Zone rouge : déplacement formellement déconseillé ; réserve au Go / No Go.</NoteAccent>}
      {rappel && <NoteAccent>{rappel}</NoteAccent>}
      <div className="text-muted sub" style={{ overflowWrap: 'anywhere' }}>
        Hébergement : {t.hebergement || 'non renseigné'} · contact sur place : {t.contactSurPlace || 'non renseigné'} · Ariane : {t.arianeLe ? `inscrit le ${fmtIso(t.arianeLe)}` : 'inscription non notée'}
      </div>
      <Fine>
        Paie : {plural(jours, 'jour', 'jours')} à l’étranger ({dest?.pays ?? t.dest}) et {plural(trajets, 'trajet', 'trajets')}, jours d’absence exclus
        {d.ds.settings.deplacementsFichierPaie ? ', dans le lot de paie de chaque mois.' : ' — à saisir dans Sage tant que les déplacements ne partent pas dans le fichier (Paramètres → Déplacements et paie).'}
      </Fine>
    </div>
  );
}
