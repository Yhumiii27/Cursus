// Fiche d'un salarié de moins de 18 ans (Collaborateurs, section Contrat) : fin des règles des jeunes travailleurs (18 ans),
// durées et repos contrôlés sur la feuille de temps, rappel de l'interdiction du travail de nuit tant que la case de son
// équipe n'est pas renseignée, dérogation pour travaux réglementés (service RH, référent HSE, lecture seule ; le manager
// n'a que l'indication « mineur », server/src/dataset.ts). Règles : shared/rules/mineurs.ts.
import { days, parse } from '../../../shared/dates.ts';
import { fmtIso, rel } from '../../../shared/format.ts';
import { equipeDeNuit, etatMineur, MINEUR_JOUR_MAX, MINEUR_SEMAINE_MAX } from '../../../shared/rules/mineurs.ts';
import type { Employe } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { NoteAccent, Tag } from './ui.tsx';

export function MineurFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh, formations, consultation } = useRole();
  const m = etatMineur(e, d.ti);
  if (!m) return null;
  const s = d.ds.settings;
  const q = d.ds.referentiels.equipes.find(x => x.nom === e.equipe);
  const g = m.derogation, n = g ? days(d.today, parse(g.fin)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div className="text-muted sub">Salarié de moins de 18 ans</div>
        <div style={{ fontSize: 14 }}>
          {m.majeurLe ? `Règles des mineurs jusqu’au ${fmtIso(m.majeurLe)}${m.aLAnnee ? ' (année de naissance seule : saisir la date complète)' : ' (18 ans)'}` : 'Règles des mineurs jusqu’à ses 18 ans'}
        </div>
        <div className="text-muted sub">
          {MINEUR_JOUR_MAX} h par jour et {MINEUR_SEMAINE_MAX} h par semaine au plus (art. L3162-1), deux jours de repos consécutifs dont le
          dimanche (art. L3164-2) : contrôlés sur la feuille de temps, un dépassement se valide avec un motif ou la référence d’une
          dérogation de l’inspection du travail.
        </div>
      </div>
      {/* Case de l'équipe pas encore renseignée (ou salarié sans équipe) : rappel permanent ; l'horaire du jour, quand la
          feuille en porte un, est contrôlé à part (shared/rules/repos-nuit.ts). */}
      {(!q || q.nuit == null) && (
        <NoteAccent>
          Pas de travail de nuit (art. L3163-2) : ni entre 22 h et 6 h, ni entre 20 h et 6 h avant 16 ans.
          {q ? ` Case « travail de nuit ou en continu » de l’équipe ${q.nom} à renseigner (Référentiels → Postes).` : ''}
        </NoteAccent>
      )}
      {q && equipeDeNuit(q) && <NoteAccent>Équipe {q.nom} cochée « travail de nuit ou en continu » : affectation à revoir (art. L3163-2).</NoteAccent>}
      {(rh || formations || consultation) && (
        <div>
          <div className="text-muted sub">Dérogation pour travaux réglementés</div>
          <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {g ? <>déclarée le {fmtIso(g.le)} · jusqu’au {fmtIso(g.fin)}
              {g.expiree ? <Tag cls="tag-accent">Expirée</Tag> : n != null && n <= s.horizonAlerte ? <Tag cls="tag-outline">À renouveler {rel(n)}</Tag> : null}</>
              : 'Aucune : pas de travaux réglementés (art. D4153-15 et suivants)'}
          </div>
          <div className="text-muted sub">Déclaration à l’inspection du travail, renouvelée tous les 3 ans (art. R4153-40 et R4153-41) ; saisie sur la fiche.</div>
        </div>
      )}
    </div>
  );
}
