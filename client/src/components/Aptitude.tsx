// Aptitude médicale d'un collaborateur (fiche, portail) : verdict, restrictions de poste, demande de visite en cours ;
// et demande de visite imprimable, que le service RH transmet au service de prévention et de santé au travail.
import type { ReactNode } from 'react';
import { AVIS_MEDICAL, CLS, MOTIFS_VISITE } from '../../../shared/constants.ts';
import type { Domain, EmpX } from '../../../shared/domain.ts';
import { equipeLabel, fmtIso } from '../../../shared/format.ts';
import { matriculeAffiche } from '../../../shared/rules/matricules.ts';
import { restrictionEnVigueur, restrictionTexte } from '../../../shared/rules/sante.ts';
import type { DemandeVisite } from '../../../shared/types.ts';
import { printDocument } from '../print.ts';
import { Tag } from './ui.tsx';

/**
 * Demande de visite imprimable (ou enregistrée en PDF) pour le service de prévention et de santé au travail :
 * identité et poste du salarié, motif de la visite, habilitations du poste qui exigent l'aptitude. Aucune donnée médicale.
 */
export function imprimerDemandeVisite(d: Domain, e: EmpX, x: DemandeVisite): boolean {
  const m = MOTIFS_VISITE[x.motif];
  const habs = e.habs.filter(h => h.delivree && h.hm.medical && h.mesure !== 'retrait');
  return printDocument('Demande de visite médicale', 'À l’attention du service de prévention et de santé au travail', [
    {
      title: 'Salarié',
      rows: [['Nom', e.nom], ['Matricule', matriculeAffiche(e)], e.naissanceLe ? ['Date de naissance', fmtIso(e.naissanceLe)] : ['Année de naissance', String(e.naissance)], ['Poste', e.poste], ['Équipe', equipeLabel(e)],
        ['Contrat', d.contratOf(e).libelle], ['Date d’entrée', fmtIso(e.entree)]],
    },
    {
      title: 'Visite demandée',
      rows: [['Motif', m.label], ['Référence', `${m.article} du Code du travail`], ['Demandée le', fmtIso(x.le)], ['Par', `${x.par}, service RH`],
        ['Dernière visite enregistrée', e.visite ? fmtIso(e.visite) : 'aucune']],
    },
    ...(habs.length ? [{ title: 'Habilitations du poste qui exigent l’aptitude médicale', table: { head: ['Habilitation', 'Détail'], rows: habs.map(h => [h.hm.nom, h.hm.detail]) } }] : []),
    { title: 'Suite donnée', text: 'Merci de convoquer le salarié et d’adresser l’avis d’aptitude au service RH, qui l’enregistre dans Cursus. Cette demande ne contient aucune information médicale.' },
  ]);
}

/**
 * Aptitude médicale : verdict, échéance et demande de visite en cours (texte de `med`), restrictions (en vigueur et
 * terminées pour le service RH et l'intéressé ; en vigueur seulement pour le manager). `actions` : boutons du service RH.
 */
export function Aptitude({ e, d, horizon, actions }: { e: EmpX; d: Domain; horizon: number; actions?: ReactNode }) {
  const m = e.med, key = d.medKey(m, horizon);
  const verdict = m.avis === 'inapte' ? AVIS_MEDICAL.inapte.label
    : !m.ok && !m.verdictSeul ? (m.visite ? 'Aptitude échue' : 'Aucune visite enregistrée')
    : !m.ok ? 'Aptitude non valide'
    : m.avis === 'restrictions' ? AVIS_MEDICAL.restrictions.court : 'Apte';
  const statut = key === 'exp' ? (m.avis === 'inapte' || m.verdictSeul ? 'Non valide' : m.visite ? 'Échue' : 'Non renseignée') : key === 'due' ? 'À renouveler' : 'Valide';
  // Verdict seul (manager) : ni date ni échéance à afficher.
  const detail = !m.verdictSeul ? m.text : m.ok || m.avis === 'inapte' ? 'Avis du médecin du travail' : 'Visite à programmer par le service RH';
  return (
    <div className="list-row stack">
      <div className="item-head">
        <div>
          <div style={{ fontSize: 14 }}>{verdict}</div>
          <div className="text-muted sub">{detail}</div>
        </div>
        <Tag cls={CLS[key]} style={{ flex: 'none' }}>{statut}</Tag>
      </div>
      {m.restrictions.length > 0 && (
        <div>
          <div className="text-muted sub">Restrictions et aménagements de poste (avis du médecin du travail)</div>
          <ul className="rules">
            {m.restrictions.map((r, i) => (
              <li key={i} className={restrictionEnVigueur(r, d.ti) ? undefined : 'text-muted'}>
                {restrictionTexte(r)}{restrictionEnVigueur(r, d.ti) ? '' : ' (terminée)'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {actions && <div className="actions-end">{actions}</div>}
    </div>
  );
}
