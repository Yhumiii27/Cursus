// Section Contrat de la fiche (Collaborateurs) : CDD (motif de recours, terme initial, renouvellements, t053), période d'essai écrite au contrat (fin, renouvellement, dernier jour pour
// notifier une rupture dans le délai de prévenance) et titre de séjour valant autorisation de travail. Le service RH voit
// le titre en entier et l'enregistre ; la lecture seule le voit sans numéro ; le manager, le référent HSE et la paie ne
// reçoivent qu'un verdict (server/src/dataset.ts), affiché seulement quand il est à régulariser.
import type { ReactNode } from 'react';
import { days, parse } from '../../../shared/dates.ts';
import { fmtIso, rel } from '../../../shared/format.ts';
import { etatAutorisation, finEssai, limitePrevenance, sortieEnregistree, sorti, TYPES_TITRE_SEJOUR } from '../../../shared/rules/contrats.ts';
import { controleCdd, estMotifRecours, MOTIFS_RECOURS } from '../../../shared/rules/cdd.ts';
import { renouvellementsDe } from '../../../shared/rules/historique-contrat.ts';
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
  const { rh, paie, consultation, soi } = useRole();
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
      <Ligne label="Titre de séjour" sub={`${e.autorisationTravail?.numero ? `N° ${e.autorisationTravail.numero} · ` : ''}${t.verifieLe ? `vérifié en préfecture le ${fmtIso(t.verifieLe)}` : t.demandeLe ? `authentification demandée à la préfecture le ${fmtIso(t.demandeLe)}` : 'demande d’authentification en préfecture non tracée'}`}>
        {TYPES_TITRE_SEJOUR[t.type].court}{t.expire ? ` · jusqu’au ${fmtIso(t.expire)}` : ' · sans expiration'}
        {n != null && (n < 0 ? <Tag cls="tag-accent">Expiré — non conforme</Tag> : n <= s.titreSejourAlerte ? <Tag cls="tag-outline">À renouveler {rel(n)}</Tag> : null)}
      </Ligne>
    );
  } else if (rh) titre = <Ligne label="Titre de séjour">Aucune autorisation de travail requise</Ligne>;

  // CDD (t053) : motif de recours, terme initial et renouvellements ; durée maximale et renouvellements admis rappelés
  // (service RH, paie, lecture seule, intéressé : le manager ne reçoit pas le motif). Motif rappelé tant qu'il manque.
  const dossier = rh || paie || consultation;
  const cdd = e.typeContrat === 'cdd' && (dossier || e.id === soi) ? (() => {
    const ren = renouvellementsDe(d, e.id), sortie = sortieEnregistree(e);
    const motif = estMotifRecours(e.motifRecours) ? MOTIFS_RECOURS[e.motifRecours] : null;
    const alertes = dossier && !parti ? controleCdd(e, { renouvellements: ren.length, reglages: s, sortie }).warnings : [];
    return (
      <>
        <Ligne label="CDD" sub={[
          motif?.article ?? '',
          e.cddFinInitiale ? `terme initial le ${fmtIso(e.cddFinInitiale)}` : '',
          ren.length ? `renouvelé ${ren.length === 1 ? 'une fois' : `${ren.length} fois`} (dernier avenant${ren.at(-1)!.signeLe ? ` signé le ${fmtIso(ren.at(-1)!.signeLe!)}` : ''})` : 'aucun renouvellement',
        ].filter(Boolean).join(' · ')}>
          {motif ? motif.label : <Tag cls="tag-outline">Motif de recours à renseigner</Tag>}
        </Ligne>
        {alertes.filter(w => !w.startsWith('Motif de recours')).map(w => <NoteAccent key={w}>{w}</NoteAccent>)}
      </>
    );
  })() : null;
  const renouvelable = rh && !parti && e.typeContrat === 'cdd' && !!e.fin && !sortieEnregistree(e);

  if (!essai && !titre && !cdd && !(rh && !parti)) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {cdd}
      {essai}
      {titre}
      {rh && !parti && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {renouvelable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'renouvelerCdd', empId: e.id })}>Renouveler le CDD</button>}
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
