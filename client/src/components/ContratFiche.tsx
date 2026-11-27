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
import { t } from '../i18n/langue.ts';

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
      <Ligne label={t('Trial period')} sub={lim.delai ? `${t('Termination by the employer to notify at the latest on ')}${fmtIso(lim.le)}${t(' (notice of ')}${lim.delai}${t(', art. L1221-25)')}` : undefined}>
        {t('until ')}{fmtIso(fe)}{e.essaiRenouveleJusquau ? <span className="text-muted">{t('· renewed (initial end on ')}{fmtIso(e.essaiFin!)})</span> : null}
        {n < 0 ? <Tag cls="tag-accent">{t('Notice period exceeded')}</Tag> : n <= s.horizonAlerte ? <Tag cls="tag-outline">{t('Decision ')}{rel(n)}</Tag> : null}
      </Ligne>
    );
  })() : null;

  // Titre de séjour : détail (service RH, lecture seule) ou verdict seul (à régulariser uniquement).
  const aut = etatAutorisation(e, d.ti);
  let titre: ReactNode = null;
  if (aut.verdictSeul) {
    if (aut.expiree) titre = <NoteAccent>{t('Work authorisation expired: situation to regularise with HR before any new working hour.')}</NoteAccent>;
  } else if (aut.requise && aut.type) {
    const n = aut.expire ? days(d.today, parse(aut.expire)) : null;
    titre = (
      <Ligne label={t('Residence permit')} sub={`${e.autorisationTravail?.numero ? `${t('No. ')}${e.autorisationTravail.numero} · ` : ''}${aut.verifieLe ? `${t('checked with the prefecture on ')}${fmtIso(aut.verifieLe)}` : aut.demandeLe ? `${t('authentication requested from the prefecture on ')}${fmtIso(aut.demandeLe)}` : t('authentication request to the prefecture not traced')}`}>
        {TYPES_TITRE_SEJOUR[aut.type].court}{aut.expire ? `${t(' · until ')}${fmtIso(aut.expire)}` : t(' · no expiry')}
        {n != null && (n < 0 ? <Tag cls="tag-accent">{t('Expired — non-compliant')}</Tag> : n <= s.titreSejourAlerte ? <Tag cls="tag-outline">{t('To renew ')}{rel(n)}</Tag> : null)}
      </Ligne>
    );
  } else if (rh) titre = <Ligne label={t('Residence permit')}>{t('No work authorisation required')}</Ligne>;

  // CDD (t053) : motif de recours, terme initial et renouvellements ; durée maximale et renouvellements admis rappelés
  // (service RH, paie, lecture seule, intéressé : le manager ne reçoit pas le motif). Motif rappelé tant qu'il manque.
  const dossier = rh || paie || consultation;
  const cdd = e.typeContrat === 'cdd' && (dossier || e.id === soi) ? (() => {
    const ren = renouvellementsDe(d, e.id), sortie = sortieEnregistree(e);
    const motif = estMotifRecours(e.motifRecours) ? MOTIFS_RECOURS[e.motifRecours] : null;
    const alertes = dossier && !parti ? controleCdd(e, { renouvellements: ren.length, reglages: s, sortie }).warnings : [];
    return (
      <>
        <Ligne label={t('Fixed-term contract')} sub={[
          motif?.article ?? '',
          e.cddFinInitiale ? `${t('initial term on ')}${fmtIso(e.cddFinInitiale)}` : '',
          ren.length ? `${t('renewed ')}${ren.length === 1 ? t('once') : `${ren.length}${t(' times')}`}${t(' (last amendment')}${ren.at(-1)!.signeLe ? `${t(' signed on ')}${fmtIso(ren.at(-1)!.signeLe!)}` : ''})` : t('no renewal'),
        ].filter(Boolean).join(' · ')}>
          {motif ? motif.label : <Tag cls="tag-outline">{t('Reason for use to enter')}</Tag>}
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
          {renouvelable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'renouvelerCdd', empId: e.id })}>{t('Renew the fixed-term contract')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'autorisation', empId: e.id })}>{t('Residence permit')}</button>
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
  const aut = etatAutorisation(e, d.ti);
  if (!aut.expiree) return null;
  const texte = e.id === me
    ? `${t('Your residence permit has expired')}${aut.expire ? `${t(' on #le')}${fmtIso(aut.expire)}` : ''}${t(': contact HR.')}`
    : aut.verdictSeul
      ? `${t('Work authorisation of ')}${e.nom}${t(' expired: situation to regularise with HR before any new working hour.')}`
      : `${t('Residence permit of ')}${e.nom}${t(' expired on #masc')}${fmtIso(aut.expire!)}${t(': they can no longer be employed without a valid permit (art. L5221-8).')}`;
  return <NoteAccent>{texte}</NoteAccent>;
}
