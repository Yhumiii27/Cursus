// Fiche du collaborateur et portail (lot 6, chantier 4, étape 2) : formations suivies (t116), habilitations antérieures
// et impression du titre d'habilitation (t115). Formations suivies : saisie et correction par le service RH et le
// référent HSE, suppression d'une saisie erronée par l'administrateur RH (motif), demandes hors catalogue acceptées à
// clore une fois la formation faite. Habilitations antérieures : délivrances remplacées par un renouvellement, mesure
// figée sans motif. Le manager et le salarié les consultent ; ni l'un ni l'autre n'imprime le titre à signer.
import type { ReactNode } from 'react';
import { PrinterIcon } from '@phosphor-icons/react';
import { parse } from '../../../shared/dates.ts';
import type { EmpX, HabInfo } from '../../../shared/domain.ts';
import { fH, fmt } from '../../../shared/format.ts';
import { demandesAClore, heuresSuivie, intituleSuivie, ORIGINE_SUIVIE_LABEL, suivieCertifiee, suiviesEnVigueur, suiviesHorsCertifications } from '../../../shared/rules/formations-suivies.ts';
import type { FormationSuivie } from '../../../shared/types.ts';
import { delivrancesAnterieures, mesureFigee } from '../passeport.ts';
import { aideMotifCorrection } from '../state/confirmations-corrections.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { imprimerTitre, titreDocument, titreImprimable } from '../titre-habilitation.ts';
import { Empty, Panel, SectionLabel, Tag } from './ui.tsx';
import { t } from '../i18n/langue.ts';

const date = (j: string) => fmt(parse(j));

/** Suppression d'une formation suivie saisie par erreur (administrateur RH), motif obligatoire. */
export function suppressionSuivie(x: Pick<FormationSuivie, 'id' | 'demandeId'>, nom: string, quoi: string): Confirmation {
  return {
    titre: t('Delete the attended training course'),
    question: `${t('Delete #verb')}${quoi}${t(' from the file of ')}${nom}${t('?#question')}`,
    suites: [
      t('It stays in the database, dated and signed, but no longer counts: training passport, 8-year review, plan indicators.'),
      x.demandeId ? t('The off-catalogue request it closes becomes to close again.') : '',
    ].filter(Boolean),
    bouton: t('Delete the training course'),
    action: 'formationSuivie.annuler',
    payload: { id: x.id },
    motif: { label: t('Reason for the deletion'), requis: true, placeholder: t('Entered on the wrong sheet, training cancelled…'), aide: aideMotifCorrection() },
  };
}

/** Ligne d'une formation suivie : intitulé, dates, durée, organisme, origine. */
function LigneSuivie({ x, actions }: { x: FormationSuivie; actions?: ReactNode }) {
  const d = useDomain();
  const h = heuresSuivie(d, x);
  const dates = x.au !== x.du ? `${t('from #du-min')}${date(x.du)}${t(' to #au')}${date(x.au)}` : `${t('on ')}${date(x.du)}`;
  // Certification enregistrée pour la même formation : c'est elle qui compte (passeport, indicateurs).
  const certifiee = suivieCertifiee(d.emp(x.empId), x);
  return (
    <div className="list-row stack">
      <div className="item-head">
        <div>
          <div style={{ fontSize: 14 }}>{intituleSuivie(d, x)}</div>
          <div className="text-muted sub">
            {t('Attended#fem')} {dates} · {h == null ? t('duration unknown') : fH(h)}{x.organisme ? ` · ${x.organisme}` : ''} · {ORIGINE_SUIVIE_LABEL[x.origine]}{certifiee ? t(' · certification recorded') : ''}
          </div>
        </div>
        <Tag cls={x.obligatoire ? 'tag-neutral' : 'tag-outline'} style={{ flex: 'none' }}>{t(x.obligatoire ? 'Mandatory#fem' : 'Not mandatory#fem')}</Tag>
      </div>
      {actions}
    </div>
  );
}

/** Formations suivies de la fiche ; service RH et référent HSE : saisie, correction, demandes hors catalogue à clore. */
export function FormationsSuiviesFiche({ e, parti }: { e: EmpX; parti: boolean }) {
  const d = useDomain();
  const { formations, admin } = useRole();
  const { openDialog } = useStore();
  const liste = suiviesEnVigueur(d.ds, e.id).sort((a, b) => b.du.localeCompare(a.du) || b.id - a.id);
  const aClore = formations ? demandesAClore(d.ds, e.id) : [];
  if (!liste.length && !aClore.length && !(formations && !parti)) return null;
  return <>
    <SectionLabel>{t('Attended training courses')}</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {aClore.map(r => (
        <div key={`d${r.id}`} className="list-row stack">
          <div className="item-head">
            <div>
              <div style={{ fontSize: 14 }}>{r.libelle}</div>
              <div className="text-muted sub">{t('Off-catalogue request accepted on ')}{date(r.date)}{t(' · to record once the training is done')}</div>
            </div>
            <Tag cls="tag-outline" style={{ flex: 'none' }}>{t('To close')}</Tag>
          </div>
          <div className="actions-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formationSuivie', empId: e.id, demandeId: r.id })}>{t('Record the attended training course')}</button>
          </div>
        </div>
      ))}
      {liste.map(x => (
        <LigneSuivie key={x.id} x={x} actions={formations && (
          <div className="actions-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formationSuivie', empId: e.id, id: x.id })}>{t('Correct')}</button>
            {admin && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: suppressionSuivie(x, e.nom, `${intituleSuivie(d, x)}${t(' of #du')}${date(x.du)}`) })}>{t('Delete')}</button>}
          </div>
        )} />
      ))}
      {!liste.length && !aClore.length && <Empty pad="sm">{t('No attended training recorded apart from certifications.')}</Empty>}
    </div>
    {formations && !parti && (
      <div className="actions-end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formationSuivie', empId: e.id })}>{t('Record an attended training course')}</button>
      </div>
    )}
  </>;
}

/** Délivrances antérieures des habilitations (renouvellements), sur la fiche. */
export function HabilitationsAnterieures({ e }: { e: EmpX }) {
  const d = useDomain();
  const liste = delivrancesAnterieures(d, e.id);
  if (!liste.length) return null;
  return <>
    <SectionLabel>{t('Previous authorisations')}</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {liste.map(x => (
        <div key={x.id} className="list-row past">
          <div className="grow">
            <div style={{ fontSize: 13 }}>{d.hm(x.h)?.nom ?? x.h}</div>
            <div className="sub">
              {t('Issued on ')}{date(x.delivree)}{x.par ? `${t(' by ')}${x.par}` : ''}{x.expire ? `${t(' · expired on #was')}${date(x.expire)}` : ''}{t(' · replaced on ')}{date(x.remplaceeLe!)}
              {mesureFigee(x) ? ` · ${mesureFigee(x).toLowerCase()}` : ''}
            </div>
          </div>
          <Tag cls="tag-outline" style={{ flex: 'none' }}>{t('Replaced#fem')}</Tag>
        </div>
      ))}
    </div>
  </>;
}

/** Bouton « Imprimer le titre » d'une habilitation en vigueur (titreImprimable) : service RH et référent HSE. */
export function ImprimerTitre({ e, h }: { e: EmpX; h: HabInfo }) {
  const { formations } = useRole();
  const { notify } = useStore();
  if (!formations || !titreImprimable(h)) return null;
  const imprimer = () => {
    if (!imprimerTitre(e, h.hm, { delivree: h.delivree!, par: h.par! })) notify(t('Allow pop-up windows to print the title'), true);
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={imprimer} aria-label={`${t('Print the ')}${titreDocument(h.hm).toLowerCase()}${t(': ')}${h.hm.nom}`}>
      <PrinterIcon size={14} /> {t('Print the title')}
    </button>
  );
}

/** Portail : formations suivies du salarié (lecture). */
export function FormationsSuiviesPortail({ empId }: { empId: number }) {
  const d = useDomain();
  const liste = suiviesHorsCertifications(d, empId).sort((a, b) => b.du.localeCompare(a.du) || b.id - a.id);
  if (!liste.length) return null;
  return (
    <Panel title={t('My attended training courses')} aside={t('apart from certifications')} style={{ gap: 'var(--space-2)' }}>
      <div className="list">{liste.map(x => <LigneSuivie key={x.id} x={x} />)}</div>
    </Panel>
  );
}
