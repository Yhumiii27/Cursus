// Section Contrat de la fiche (Collaborateurs) : période d'essai écrite au contrat (fin, renouvellement, dernier jour pour
// notifier une rupture dans le délai de prévenance) et titre de séjour valant autorisation de travail. Le service RH voit
// le titre en entier et l'enregistre ; la lecture seule le voit sans numéro ; le manager, le référent HSE et la paie ne
// reçoivent qu'un verdict (server/src/dataset.ts), affiché seulement quand il est à régulariser.
import type { ReactNode } from 'react';
import { days, parse } from '../../../shared/dates.ts';
import { fmtIso, rel } from '../../../shared/format.ts';
import { etatAutorisation, finEssai, limitePrevenance, sorti, TYPES_TITRE_SEJOUR } from '../../../shared/rules/contrats.ts';
import type { Employe } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { NoteAccent, Tag } from './ui.tsx';

/** Ligne d'information : libellé atténué, valeur, précision. */
function Ligne({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-muted sub">{label}</div>
      <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>{children}</div>
      {sub != null && <div className="text-muted sub">{sub}</div>}
    </div>
  );
}

export function ContratFiche({ e }: { e: Employe }) {
  const d = useDomain();
  const { rh } = useRole();
  const { openDialog } = useStore();
  const parti = sorti(e, d.ti);
  const s = d.ds.settings;

  // Période d'essai : affichée tant qu'elle court (passée, elle n'appelle plus rien).
  const fe = finEssai(e), lim = limitePrevenance(e);
  const essai = fe && fe >= d.ti && lim ? (() => {
    const n = days(d.today, parse(lim.le));
    return (
      <Ligne label="Période d’essai" sub={lim.delai ? `Rupture par l’employeur à notifier au plus tard le ${fmtIso(lim.le)} (prévenance de ${lim.delai}, art. L1221-25)` : undefined}>
        jusqu’au {fmtIso(fe)}{e.essaiRenouveleJusquau ? <span className="text-muted">· renouvelée (fin initiale le {fmtIso(e.essaiFin!)})</span> : null}
        {n < 0 ? <Tag cls="tag-accent">Prévenance dépassée</Tag> : n <= s.horizonAlerte ? <Tag cls="tag-outline">Décision {rel(n)}</Tag> : null}
      </Ligne>
    );
  })() : null;

  // Titre de séjour : détail (service RH, lecture seule) ou verdict seul (à régulariser uniquement).
  const t = etatAutorisation(e, d.ti);
  let titre: ReactNode = null;
  if (t.verdictSeul) {
    if (t.expiree) titre = <NoteAccent>Autorisation de travail expirée : situation à régulariser avec le service RH avant toute nouvelle heure de travail.</NoteAccent>;
  } else if (t.requise && t.type) {
    const n = t.expire ? days(d.today, parse(t.expire)) : null;
    titre = (
      <Ligne label="Titre de séjour" sub={`${e.autorisationTravail?.numero ? `N° ${e.autorisationTravail.numero} · ` : ''}${t.verifieLe ? `vérifié en préfecture le ${fmtIso(t.verifieLe)}` : 'vérification en préfecture non tracée'}`}>
        {TYPES_TITRE_SEJOUR[t.type].court}{t.expire ? ` · jusqu’au ${fmtIso(t.expire)}` : ' · sans expiration'}
        {n != null && (n < 0 ? <Tag cls="tag-accent">Expiré — non conforme</Tag> : n <= s.titreSejourAlerte ? <Tag cls="tag-outline">À renouveler {rel(n)}</Tag> : null)}
      </Ligne>
    );
  } else if (rh) titre = <Ligne label="Titre de séjour">Aucune autorisation de travail requise</Ligne>;

  if (!essai && !titre && !(rh && !parti)) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {essai}
      {titre}
      {rh && !parti && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'autorisation', empId: e.id })}>Titre de séjour</button>
        </div>
      )}
    </div>
  );
}

/**
 * Avertissement de la saisie des heures (écran Temps) : titre de séjour expiré. Il n'empêche pas la saisie (heures déjà
 * faites à payer) mais rappelle que le salarié ne peut plus être employé (art. L5221-8). Le manager ne lit que le verdict.
 */
export function AlerteAutorisation({ e }: { e: Employe }) {
  const d = useDomain();
  const { me } = useRole();
  const t = etatAutorisation(e, d.ti);
  if (!t.expiree) return null;
  const texte = e.id === me
    ? `Votre titre de séjour a expiré${t.expire ? ` le ${fmtIso(t.expire)}` : ''} : prenez contact avec le service RH.`
    : t.verdictSeul
      ? `Autorisation de travail de ${e.nom} expirée : situation à régulariser avec le service RH avant toute nouvelle heure de travail.`
      : `Titre de séjour de ${e.nom} expiré le ${fmtIso(t.expire!)} : il ne peut plus être employé sans titre valable (art. L5221-8).`;
  return <NoteAccent>{texte}</NoteAccent>;
}
