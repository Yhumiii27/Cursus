// Paramètres → Conservation des dossiers (t016, shared/rules/conservation.ts) : durées de conservation par catégorie après
// la sortie, référence de la décision du DPO et case « Proposer les dossiers échus » (désactivée par défaut : réponse de
// l'entreprise du 18 octobre 2026, aucune proposition sans la décision du DPO), liste des dossiers échus avec confirmation
// un par un ou par lot (dialogs/AnonymiserDialog.tsx), droit à l'effacement exercé avant l'échéance. Réservée à
// l'administrateur RH : la liste nomme des salariés partis et l'effacement est irréversible.
import { useEffect, useMemo, useState } from 'react';
import { fmtIso } from '../../../../shared/format.ts';
import { CATEGORIES, CATEGORIES_CONSERVATION, conservationActive, DUREE_MAX_ANS, DOSSIER_MIN_ANS, echeanceConservation, FRAIS_MIN_ANS } from '../../../../shared/rules/conservation.ts';
import { sorti } from '../../../../shared/rules/contrats.ts';
import type { CategorieConservation, Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Panel, SectionLabel, Tag } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';
import { t, tn } from '../../i18n/langue.ts';

type Durees = Record<CategorieConservation, number>;
const ANS = Array.from({ length: DUREE_MAX_ANS + 1 }, (_, n) => n);
const ansTexte = (n: number) => (n === 0 ? t('On leaving') : tn(n, 'year#count', 'years#count'));
const dureesDe = (s: Settings): Durees => Object.fromEntries(CATEGORIES.map(c => [c, s[CATEGORIES_CONSERVATION[c].reglage]])) as Durees;

/** Réglages : case, décision du DPO et durées, enregistrés ensemble (les règles de cohérence portent sur l'ensemble). */
function Reglages({ s }: { s: Settings }) {
  const save = useEnregistrerReglages();
  const [actif, setActif] = useState(s.conservationActive);
  const [decision, setDecision] = useState(s.conservationDecisionDpo);
  const [durees, setDurees] = useState<Durees>(dureesDe(s));
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setActif(s.conservationActive); setDecision(s.conservationDecisionDpo); setDurees(dureesDe(s)); setTente(false); }, [s]);
  const erreurDecision = actif && !decision.trim() ? t('Enter the reference of the DPO’s decision that sets these durations.') : null;
  const trop = CATEGORIES.filter(c => c !== 'dossier' && durees[c] > durees.dossier);
  const erreurDurees = durees.dossier < DOSSIER_MIN_ANS ? `${t('The file is kept ')}${DOSSIER_MIN_ANS}${t(' years at least after leaving: the identity and the residence permit appear in the single personnel register (art. R1221-26).')}`
    : trop.length ? t('No category beyond the file: its anonymisation erases everything.') : null;
  const modifie = actif !== s.conservationActive || decision.trim() !== s.conservationDecisionDpo || CATEGORIES.some(c => durees[c] !== dureesDe(s)[c]);
  const enregistrer = async () => {
    if (erreurDecision || erreurDurees) { setTente(true); document.getElementById(erreurDecision ? 'param-conservation-dpo' : 'param-conservation-dossier')?.focus(); return; }
    setBusy(true);
    await save({ conservationActive: actif, conservationDecisionDpo: decision, ...Object.fromEntries(CATEGORIES.map(c => [CATEGORIES_CONSERVATION[c].reglage, durees[c]])) });
    setBusy(false);
  };
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={actif} onChange={e => setActif(e.target.checked)}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>{t('Offer the expired files: Cursus lists each day the files of the employees who left for which a duration has expired and notifies HR; nothing is erased without your confirmation')}</span>
      </label>
      <Field label={t('Reference of the DPO’s decision')} htmlFor="param-conservation-dpo" requis={actif} erreur={tente && erreurDecision}>
        <input className="input" id="param-conservation-dpo" maxLength={120} placeholder={t('DPO’s decision of … on the retention periods')} value={decision}
          onChange={e => setDecision(e.target.value)} />
      </Field>
      <div className="grid-2">
        {CATEGORIES.map(c => (
          <Field key={c} label={CATEGORIES_CONSERVATION[c].label} htmlFor={`param-conservation-${c}`} erreur={tente && c === 'dossier' && erreurDurees}>
            <select className="input" id={`param-conservation-${c}`} value={durees[c]} onChange={e => setDurees({ ...durees, [c]: Number(e.target.value) })}>
              {/* lot 11 — notes de frais : 10 ans au moins (pièces comptables, art. L123-22 du Code de commerce). */}
              {ANS.filter(n => c !== 'frais' || n >= FRAIS_MIN_ANS).map(n => <option key={n} value={n}>{ansTexte(n)}</option>)}
            </select>
          </Field>
        ))}
      </div>
      {modifie && (
        <div className="actions-end">
          <Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the retention periods')}</Btn>
        </div>
      )}
    </>
  );
}

export function Conservation({ s }: SectionProps) {
  const { admin } = useRole();
  const d = useDomain();
  const { openDialog } = useStore();
  const echus = useMemo(() => d.ds.conservation ?? [], [d.ds.conservation]);
  const [coches, setCoches] = useState<Set<number>>(new Set());
  const [demandeur, setDemandeur] = useState('');
  useEffect(() => { setCoches(c => new Set([...c].filter(id => echus.some(x => x.empId === id)))); }, [echus]);
  // Droit à l'effacement : salariés sortis dont le dossier n'est pas encore anonymisé.
  const sortis = d.ds.employes.filter(e => e.fin && sorti(e, d.ti) && !e.anonymiseLe).sort((a, b) => a.nom.localeCompare(b.nom));
  if (!admin) return null;
  const active = conservationActive(s);
  const tous = echus.length > 0 && coches.size === echus.length;
  const basculer = (id: number) => setCoches(c => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Panel title={t('Retention of files')} aside={<Tag cls={active ? 'tag-neutral' : 'tag-outline'}>{active ? t('Proposals active') : t('Inactive#fem')}</Tag>} style={{ gap: 'var(--space-4)' }}>
      {!active && (
        <NoteAccent>
          {t('Durations prefilled (usual references) but inactive: no file is offered as long as the box is not ticked with the reference of the DPO’s decision. Nothing is ever erased automatically.')}
        </NoteAccent>
      )}
      <Reglages s={s} />
      <Fine>
        {t('Durations in years after the last day of the contract. Each expired category is erased separately (passport and visas, health, residence permit, reviews, free texts and supporting documents of time, reasons and documents of training courses); at the due date of the file, the sheet is anonymised (“Anonymised employee no. …”) and everything still nominative is erased, up to the name in the log of actions. The hours per project, the absences, the training costs and the payroll batches already transmitted stay, without a name. The backups keep the erased data until their rotation.')}
      </Fine>

      <SectionLabel>{t('Expired files')}</SectionLabel>
      {!active ? <Empty pad="sm">{t('Proposals inactive.')}</Empty> : !echus.length ? <Empty pad="sm">{t('No expired file.')}</Empty> : (
        <>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label={t('Select all')} checked={tous} onChange={() => setCoches(tous ? new Set() : new Set(echus.map(x => x.empId)))} style={{ accentColor: 'var(--color-accent)' }} /></th>
                  <th>{t('Employee#salarie')}</th><th>{t('Departure#exit')}</th><th>{t('To erase')}</th><th>{t('Items#elements')}</th>
                </tr>
              </thead>
              <tbody>
                {echus.map(x => (
                  <tr key={x.empId}>
                    <td><input type="checkbox" aria-label={`${t('Select ')}${d.emp(x.empId)?.nom ?? `${t('the file no. ')}${x.empId}`}`} checked={coches.has(x.empId)} onChange={() => basculer(x.empId)} style={{ accentColor: 'var(--color-accent)' }} /></td>
                    <td>{d.emp(x.empId)?.nom ?? `${t('no. ')}${x.empId}`}</td>
                    <td className="nowrap">{fmtIso(x.fin)}</td>
                    <td className="text-muted" style={{ fontSize: 13 }}>
                      {x.dossier ? <><Tag cls="tag-accent">{t('File to anonymise')}</Tag>{t(' expired since ')}{fmtIso(echeanceConservation(x.fin, s.conservationDossierAns))}</>
                        : x.categories.map(c => CATEGORIES_CONSERVATION[c].label).join(', ')}
                    </td>
                    <td className="nowrap">{x.elements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions-end">
            <Btn variant="primary" disabled={!coches.size} onClick={() => openDialog({ type: 'anonymiser', ids: echus.filter(x => coches.has(x.empId)).map(x => x.empId) })}>
              {coches.size ? `${t('Erase the selection (')}${coches.size})…` : t('Erase the selection…')}
            </Btn>
          </div>
        </>
      )}

      <SectionLabel>{t('Right to erasure before the due date')}</SectionLabel>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={t('Employee who left asking for erasure')} htmlFor="param-conservation-demandeur">
          <select className="input" id="param-conservation-demandeur" value={demandeur} onChange={e => setDemandeur(e.target.value)} style={{ minWidth: 260 }}>
            <option value="">{t('Choose…')}</option>
            {sortis.map(e => <option key={e.id} value={e.id}>{e.nom}{t(' — left on ')}{fmtIso(e.fin!)}</option>)}
          </select>
        </Field>
        <Btn disabled={!demandeur} onClick={() => openDialog({ type: 'anonymiser', ids: [Number(demandeur)], avantEcheance: true })}>{t('Examine the request…')}</Btn>
      </div>
      <Fine>
        {t('An erasure request (art. 17 of the GDPR) is examined with the DPO. The file of an employee in post is not erased. For an employee who left, Cursus erases at once what comes under no legal obligation (passport and visas, reviews, reasons and requests of training courses) and keeps until their due date the identity and the residence permit (single personnel register, 5 years after departure, art. R1221-26), occupational health and working time (art. 17-3-b of the GDPR); the dialog lists what remains and until when.')}
      </Fine>
    </Panel>
  );
}
