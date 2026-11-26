// Dossier voyage (écran Voyages, service RH) : vigilance du pays de destination (France Diplomatie, t068) et rappel de
// la vérifier avant le départ, coordonnées sur place (hébergement, contact local, inscription sur Ariane) et ce que le
// déplacement donnera à la paie (t031 : jours à l'étranger et trajets, shared/rules/deplacements-paie.ts).
import { fmtIso } from '../../../shared/format.ts';
import { partsSejour } from '../../../shared/rules/deplacements-paie.ts';
import { rappelVigilance, VIGILANCES, vigilanceTexte } from '../../../shared/rules/vigilance.ts';
import type { Voyage } from '../../../shared/types.ts';
import { useDomain } from '../state/derived.ts';
import { Fine, NoteAccent, Tag } from './ui.tsx';
import { t, tn } from '../i18n/langue.ts';

export function VoyageVigilance({ t: v }: { t: Voyage }) {
  const d = useDomain();
  const dest = d.destOf(v.dest);
  const rappel = rappelVigilance(dest, v, d.ti, d.ds.settings.vigilanceRappelJours);
  const parts = partsSejour(d, { source: 'voyage', id: v.id, empId: v.empId, du: v.depart, au: v.retour, pays: v.dest }, '9999-12');
  const jours = parts.filter(p => p.rubrique === 'ETR_JOUR').reduce((n, p) => n + p.quantite, 0);
  const trajets = parts.filter(p => p.rubrique === 'TRAJET').reduce((n, p) => n + p.quantite, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {dest?.vigilance ? <Tag cls={VIGILANCES[dest.vigilance].cls}>{`${t('Vigilance ')}${dest.vigilance}`}</Tag> : <Tag cls="tag-outline">{t('Vigilance not entered')}</Tag>}
        {dest?.vigilance && <span className="text-muted sub">{vigilanceTexte(dest.vigilance)}{dest.vigilanceLe ? `${t(' · checked on #fem')}${fmtIso(dest.vigilanceLe)}` : ''}</span>}
      </div>
      {dest?.vigilance === 'rouge' && <NoteAccent>{t('Red zone: travel formally advised against; reservation at the Go / No Go.')}</NoteAccent>}
      {rappel && <NoteAccent>{rappel}</NoteAccent>}
      <div className="text-muted sub" style={{ overflowWrap: 'anywhere' }}>
        {t('Accommodation: ')}{v.hebergement || t('not entered')}{t(' · contact on site: ')}{v.contactSurPlace || t('not entered')}{t(' · Ariane: ')}{v.arianeLe ? `${t('registered on ')}${fmtIso(v.arianeLe)}` : t('registration not noted')}
      </div>
      <Fine>
        {t('Payroll: ')}{tn(jours, 'day', 'days')}{t(' abroad (')}{dest?.pays ?? v.dest}{t(') and ')}{tn(trajets, 'journey', 'journeys')}{t(', days of absence excluded')}
        {d.ds.settings.deplacementsFichierPaie ? t(', in the payroll batch of each month.') : t(' — to enter in Sage as long as trips do not go in the file (Settings → Travel and payroll).')}
      </Fine>
    </div>
  );
}
