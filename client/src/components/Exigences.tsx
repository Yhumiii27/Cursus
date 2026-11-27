// Exigences du poste et de l'équipe d'un collaborateur (shared/rules/exigences.ts), écran Collaborateurs : colonne de la
// liste et section de la fiche. Une exigence jamais obtenue rend le salarié « Non conforme » ; son action est celle de
// l'échéance « exigence manquante » (inscrire à la formation, demander ou délivrer l'habilitation), et pour le manager
// la demande au service RH.
import { CERT_LABEL, CLS, HAB_CLS, HAB_LABEL } from '../../../shared/constants.ts';
import type { EmpX, Proposal } from '../../../shared/domain.ts';
import { echeanceExigence, exigencesDe, manquantsTexte, origineTexte, posteDe } from '../../../shared/rules/exigences.ts';
import { ARTICLE_L4154, contratRenforcee, formationRenforcee } from '../../../shared/rules/formation-renforcee.ts';
import { Fine, NoteAccent, SectionLabel, Tag, Two } from './ui.tsx';
import { useDomain, useIntentPermis, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

/** État du titre qui remplit une exigence : celui de la certification en vigueur ou du titre délivré (valide, échu…). */
function Etat({ e, x }: { e: EmpX; x: { type: string; id: string } }) {
  const c = x.type === 'formation' ? e.rawCerts.find(y => y.f === x.id) : null;
  const h = x.type === 'habilitation' ? e.habs.find(y => y.h === x.id && y.delivree) : null;
  if (c) return <Tag cls={CLS[c.key]} style={{ flex: 'none' }}>{CERT_LABEL[c.key]}</Tag>;
  if (h) return <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>;
  return <Tag cls="tag-neutral" style={{ flex: 'none' }}>{t('Obtained#fem')}</Tag>;
}

/** Colonne « Exigences » de la liste : manquantes, remplies, ou aucune déclarée. */
export function ExigencesCellule({ e }: { e: EmpX }) {
  const d = useDomain();
  if (e.manquants.length) return <Tag cls="tag-accent">{tn(e.manquants.length, 'missing#fem', 'missing#fem-plural')}</Tag>;
  return exigencesDe(d.ds, e).length ? <Tag cls="tag-neutral">{t('Met#fem-plural')}</Tag> : <span className="text-muted">—</span>;
}

/** Motif du statut « Non conforme » dû aux exigences : « Formation exigée non suivie : SST ». */
export function ExigencesMotif({ e }: { e: EmpX }) {
  return e.manquants.length ? <NoteAccent>{t('Non-compliant')} · {manquantsTexte(e.manquants)}</NoteAccent> : null;
}

/**
 * Espace collaborateur : motif du statut « Non conforme » dû aux exigences de son poste ou de son équipe, avec la demande
 * de chaque formation ou habilitation manquante au service RH (dialogues de demande du portail).
 */
export function ExigencesPortail({ e }: { e: EmpX }) {
  const { openDialog } = useStore();
  if (!e.manquants.length) return null;
  return (
    <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <ExigencesMotif e={e} />
      {e.manquants.map(m => (
        <button key={`${m.type}-${m.id}`} type="button" className="btn btn-ghost btn-sm"
          onClick={() => openDialog(m.type === 'formation' ? { type: 'reqForm', f: m.id } : { type: 'reqHab' })}>
          {m.type === 'formation' ? `${t('Request the training course')} ${m.label}` : `${t('Request the authorisation')} ${m.label}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Section de la fiche : exigences qui s'appliquent, obtenues ou manquantes, avec l'action d'une manquante. `membre` :
 * manager direct (demandes au service RH) ; `parti` : salarié sorti, sans action.
 */
export function ExigencesFiche({ e, membre, parti }: { e: EmpX; membre: boolean; parti: boolean }) {
  const d = useDomain();
  const { formations } = useRole();
  const permis = useIntentPermis();
  const { openDialog, runIntent } = useStore();
  const liste = exigencesDe(d.ds, e);
  // Poste à risques particuliers (art. L4154-2) : mentionné même sans exigence (CDI), avec ce qu'il demande du contrat.
  const risques = !!posteDe(d.ds, e)?.risquesL4154;
  if (!liste.length && !risques) return null;
  const action = (m: (typeof e.manquants)[number]): Proposal | null => {
    if (parti) return null;
    const a = echeanceExigence(d, e, m);
    if (a.planned) return null;
    if (formations) return a.action && permis(a.action.intent) ? a.action : null;
    if (!membre) return null;
    return m.type === 'formation'
      ? { label: t('Request the training course'), intent: { type: 'goFormation', f: m.id } }
      : { label: t('Request the authorisation'), intent: { type: 'demanderHab', empId: e.id, h: m.id, nom: e.nom, label: m.label } };
  };
  // Manager : demandes adressées au service RH (dialogues de demande) plutôt que les actions du service RH.
  const lancer = (m: (typeof e.manquants)[number], a: Proposal) => {
    if (formations) runIntent(a.intent);
    else if (m.type === 'formation') openDialog({ type: 'reqForm', empId: e.id, f: m.id });
    else openDialog({ type: 'reqHab', empId: e.id });
  };
  return <>
    <SectionLabel>{t('Job requirements')}</SectionLabel>
    {risques && (
      <Fine>
        {t('Job with particular risks (')}{ARTICLE_L4154}{t('): reinforced safety training required of fixed-term, temporary and work-study employees')}
        {contratRenforcee(e.typeContrat) ? (formationRenforcee(d.ds) ? t(', since the start') : t(' — training not designated in Settings')) : t(' (contract not concerned)')}.
      </Fine>
    )}
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {liste.map(x => {
        const m = e.manquants.find(y => y.type === x.type && y.id === x.id);
        const nom = x.type === 'formation' ? d.fm(x.id).nom : d.hm(x.id).nom;
        const ech = m ? echeanceExigence(d, e, m) : null;
        const a = m ? action(m) : null;
        return (
          <div key={`${x.type}-${x.id}`} className="list-row stack">
            <div className="item-head">
              <Two main={nom} sub={`${t(x.type === 'formation' ? 'Training course' : 'Authorisation')} · ${origineTexte(x).replace(/^Exigence/, 'exigence')}`} />
              {m ? <Tag cls="tag-accent" style={{ flex: 'none' }}>{t('Missing#fem')}</Tag> : <Etat e={e} x={x} />}
            </div>
            {m && (ech?.plannedLabel || a) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span className="note-accent">{ech?.plannedLabel || t(x.type === 'formation' ? 'Training course never attended' : 'Authorisation never issued')}</span>
                {a && <button type="button" className="btn btn-ghost btn-sm" onClick={() => lancer(m, a)}>{a.label}</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </>;
}
