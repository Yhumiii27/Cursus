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
import { demandesAClore, heuresSuivie, intituleSuivie, ORIGINE_SUIVIE_LABEL, suiviesEnVigueur } from '../../../shared/rules/formations-suivies.ts';
import type { FormationSuivie } from '../../../shared/types.ts';
import { delivrancesAnterieures, mesureFigee } from '../passeport.ts';
import { AIDE_MOTIF_CORRECTION } from '../state/confirmations-corrections.ts';
import type { Confirmation } from '../state/confirmations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { imprimerTitre, titreDocument } from '../titre-habilitation.ts';
import { Empty, Panel, SectionLabel, Tag } from './ui.tsx';

const date = (j: string) => fmt(parse(j));

/** Suppression d'une formation suivie saisie par erreur (administrateur RH), motif obligatoire. */
export function suppressionSuivie(x: Pick<FormationSuivie, 'id' | 'demandeId'>, nom: string, quoi: string): Confirmation {
  return {
    titre: 'Supprimer la formation suivie',
    question: `Supprimer ${quoi} du dossier de ${nom} ?`,
    suites: [
      'Elle reste en base, datée et signée, mais ne compte plus : passeport formation, bilan à 8 ans, indicateurs du plan.',
      x.demandeId ? 'La demande hors catalogue qu’elle clôt redevient à clore.' : '',
    ].filter(Boolean),
    bouton: 'Supprimer la formation',
    action: 'formationSuivie.annuler',
    payload: { id: x.id },
    motif: { label: 'Motif de la suppression', requis: true, placeholder: 'Saisie sur la mauvaise fiche, formation annulée…', aide: AIDE_MOTIF_CORRECTION },
  };
}

/** Ligne d'une formation suivie : intitulé, dates, durée, organisme, origine. */
function LigneSuivie({ x, actions }: { x: FormationSuivie; actions?: ReactNode }) {
  const d = useDomain();
  const h = heuresSuivie(d, x);
  const dates = x.au !== x.du ? `du ${date(x.du)} au ${date(x.au)}` : `le ${date(x.du)}`;
  return (
    <div className="list-row stack">
      <div className="item-head">
        <div>
          <div style={{ fontSize: 14 }}>{intituleSuivie(d, x)}</div>
          <div className="text-muted sub">
            Suivie {dates} · {h == null ? 'durée inconnue' : fH(h)}{x.organisme ? ` · ${x.organisme}` : ''} · {ORIGINE_SUIVIE_LABEL[x.origine]}
          </div>
        </div>
        <Tag cls={x.obligatoire ? 'tag-neutral' : 'tag-outline'} style={{ flex: 'none' }}>{x.obligatoire ? 'Obligatoire' : 'Non obligatoire'}</Tag>
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
    <SectionLabel>Formations suivies</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {aClore.map(r => (
        <div key={`d${r.id}`} className="list-row stack">
          <div className="item-head">
            <div>
              <div style={{ fontSize: 14 }}>{r.libelle}</div>
              <div className="text-muted sub">Demande hors catalogue acceptée le {date(r.date)} · à enregistrer une fois la formation faite</div>
            </div>
            <Tag cls="tag-outline" style={{ flex: 'none' }}>À clore</Tag>
          </div>
          <div className="actions-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formationSuivie', empId: e.id, demandeId: r.id })}>Enregistrer la formation suivie</button>
          </div>
        </div>
      ))}
      {liste.map(x => (
        <LigneSuivie key={x.id} x={x} actions={formations && (
          <div className="actions-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formationSuivie', empId: e.id, id: x.id })}>Corriger</button>
            {admin && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: suppressionSuivie(x, e.nom, `${intituleSuivie(d, x)} du ${date(x.du)}`) })}>Supprimer</button>}
          </div>
        )} />
      ))}
      {!liste.length && !aClore.length && <Empty pad="sm">Aucune formation suivie enregistrée hors certifications.</Empty>}
    </div>
    {formations && !parti && (
      <div className="actions-end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'formationSuivie', empId: e.id })}>Enregistrer une formation suivie</button>
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
    <SectionLabel>Habilitations antérieures</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {liste.map(x => (
        <div key={x.id} className="list-row past">
          <div className="grow">
            <div style={{ fontSize: 13 }}>{d.hm(x.h)?.nom ?? x.h}</div>
            <div className="sub">
              Délivrée le {date(x.delivree)}{x.par ? ` par ${x.par}` : ''}{x.expire ? ` · expirait le ${date(x.expire)}` : ''} · remplacée le {date(x.remplaceeLe!)}
              {mesureFigee(x) ? ` · ${mesureFigee(x).toLowerCase()}` : ''}
            </div>
          </div>
          <Tag cls="tag-outline" style={{ flex: 'none' }}>Remplacée</Tag>
        </div>
      ))}
    </div>
  </>;
}

/** Bouton « Imprimer le titre » d'une habilitation délivrée : service RH et référent HSE. */
export function ImprimerTitre({ e, h }: { e: EmpX; h: HabInfo }) {
  const { formations } = useRole();
  const { notify } = useStore();
  if (!formations || !h.delivree || !h.par) return null;
  const imprimer = () => {
    if (!imprimerTitre(e, h.hm, { delivree: h.delivree!, par: h.par! })) notify('Autorisez les fenêtres surgissantes pour imprimer le titre', true);
  };
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={imprimer} aria-label={`Imprimer le ${titreDocument(h.hm).toLowerCase()} : ${h.hm.nom}`}>
      <PrinterIcon size={14} /> Imprimer le titre
    </button>
  );
}

/** Portail : formations suivies du salarié (lecture). */
export function FormationsSuiviesPortail({ empId }: { empId: number }) {
  const d = useDomain();
  const liste = suiviesEnVigueur(d.ds, empId).sort((a, b) => b.du.localeCompare(a.du) || b.id - a.id);
  if (!liste.length) return null;
  return (
    <Panel title="Mes formations suivies" aside="hors certifications" style={{ gap: 'var(--space-2)' }}>
      <div className="list">{liste.map(x => <LigneSuivie key={x.id} x={x} />)}</div>
    </Panel>
  );
}
