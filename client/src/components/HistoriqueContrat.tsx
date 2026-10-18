// Section « Historique du contrat » de la fiche (Collaborateurs, t074) : embauche, avenants (organisation du temps, statut,
// nature du contrat) et renouvellements d'un CDD, du plus récent au plus ancien, avec l'avenant programmé à une date
// future (annulable par le service RH tant qu'il n'est pas appliqué). Réembauche : fiches précédentes du même matricule
// de paie, en lien d'information (service RH, paie, lecture seule). Le manager et le salarié voient les lignes sans
// référence ni auteur (server/src/dataset.ts) ; le référent HSE ne les reçoit pas.
import { fmtIso } from '../../../shared/format.ts';
import { TYPES_CONTRAT } from '../../../shared/constants.ts';
import { sorti } from '../../../shared/rules/contrats.ts';
import { lignesContrat, NATURES_LIGNE_CONTRAT } from '../../../shared/rules/historique-contrat.ts';
import type { ContratHistorique, Employe } from '../../../shared/types.ts';
import { annulationAvenant } from '../state/confirmations-contrats.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Tag } from './ui.tsx';

export function HistoriqueContrat({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh, espaceRh } = useRole();
  const { openDialog, setUi } = useStore();
  const toutes = (d.ds.contratsHistorique ?? []).filter(l => l.empId === e.id);
  const enVigueur = lignesContrat(d, e.id);
  // Réembauche : autres fiches qui portent le même matricule de paie (réutilisé avec confirmation de l'administrateur RH).
  const precedentes = espaceRh && e.matriculePaie ? d.ds.employes.filter(x => x.id !== e.id && x.matriculePaie === e.matriculePaie) : [];
  if (!toutes.length && !precedentes.length) return null;

  const regimeTexte = (l: ContratHistorique) => (l.regime ? d.contratOf({ ...e, ...l.regime }).label : 'régime antérieur non connu');
  const ligne = (l: ContratHistorique) => {
    const programme = !l.applique && !l.annuleLe, annule = !!l.annuleLe;
    const quoi = l.nature === 'renouvellement'
      ? `jusqu’au ${fmtIso(l.jusquau!)}`
      : `${regimeTexte(l)}${l.regime && l.nature === 'embauche' ? ` · ${TYPES_CONTRAT[l.regime.typeContrat]?.label ?? ''}` : ''}${l.jusquau ? ` · jusqu’au ${fmtIso(l.jusquau)}` : ''}`;
    const sub = [
      l.signeLe ? `avenant signé le ${fmtIso(l.signeLe)}` : '',
      l.reference ?? '',
      // Lignes amorcées depuis la fiche (migration, jeu de démonstration) : reprises, sans auteur.
      l.par === 'Cursus' ? `repris de la fiche le ${fmtIso(l.le)}` : l.par ? `enregistré le ${fmtIso(l.le)} par ${l.par}` : '',
      l.fin ? `contrat terminé le ${fmtIso(l.fin)}` : '',
      annule ? `annulé le ${fmtIso(l.annuleLe!)}` : '',
    ].filter(Boolean).join(' · ');
    return (
      <li key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 14 }}>
          <span className={annule ? 'text-muted' : undefined}>{l.nature === 'renouvellement' ? 'Le' : 'À compter du'} {fmtIso(l.effet)} · {NATURES_LIGNE_CONTRAT[l.nature]} · {quoi}</span>
          {programme && <Tag cls="tag-outline">Programmé</Tag>}
          {annule && <Tag cls="tag-neutral">Annulé</Tag>}
          {programme && rh && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({
              type: 'confirmer', c: annulationAvenant(l, e.nom, regimeTexte(l), d.contratOf(e).label),
            })}>Annuler l’avenant</button>
          )}
        </div>
        {sub && <div className="text-muted sub">{sub}</div>}
      </li>
    );
  };
  // Du plus récent au plus ancien ; les lignes annulées à la suite des autres.
  const ordre = [...enVigueur].reverse().concat(toutes.filter(l => l.annuleLe));

  return (
    <div>
      <div className="text-muted sub">Historique du contrat</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {ordre.map(ligne)}
      </ul>
      {precedentes.map(x => (
        <div key={x.id} className="text-muted sub" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
          <span>Fiche précédente (même matricule de paie) : {x.nom}, {TYPES_CONTRAT[x.typeContrat]?.label ?? x.typeContrat} du {fmtIso(x.entree)}{x.fin ? ` au ${fmtIso(x.fin)}` : ''}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUi({ statut: sorti(x, d.ti) ? 'sortis' : 'tous', selectedId: x.id })}>Ouvrir la fiche</button>
        </div>
      ))}
    </div>
  );
}
