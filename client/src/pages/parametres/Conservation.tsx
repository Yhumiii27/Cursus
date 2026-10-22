// Paramètres → Conservation des dossiers (t016, shared/rules/conservation.ts) : durées de conservation par catégorie après
// la sortie, référence de la décision du DPO et case « Proposer les dossiers échus » (désactivée par défaut : réponse de
// l'entreprise du 18 octobre 2026, aucune proposition sans la décision du DPO), liste des dossiers échus avec confirmation
// un par un ou par lot (dialogs/AnonymiserDialog.tsx), droit à l'effacement exercé avant l'échéance. Réservée à
// l'administrateur RH : la liste nomme des salariés partis et l'effacement est irréversible.
import { useEffect, useMemo, useState } from 'react';
import { fmtIso, plural } from '../../../../shared/format.ts';
import { CATEGORIES, CATEGORIES_CONSERVATION, conservationActive, DUREE_MAX_ANS, DOSSIER_MIN_ANS, echeanceConservation } from '../../../../shared/rules/conservation.ts';
import { sorti } from '../../../../shared/rules/contrats.ts';
import type { CategorieConservation, Settings } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Empty, Fine, NoteAccent, Panel, SectionLabel, Tag } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { type SectionProps, useEnregistrerReglages } from './commun.ts';

type Durees = Record<CategorieConservation, number>;
const ANS = Array.from({ length: DUREE_MAX_ANS + 1 }, (_, n) => n);
const ansTexte = (n: number) => (n === 0 ? 'À la sortie' : plural(n, 'an', 'ans'));
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
  const erreurDecision = actif && !decision.trim() ? 'Indiquez la référence de la décision du DPO qui fixe ces durées.' : null;
  const trop = CATEGORIES.filter(c => c !== 'dossier' && durees[c] > durees.dossier);
  const erreurDurees = durees.dossier < DOSSIER_MIN_ANS ? `Le dossier se garde ${DOSSIER_MIN_ANS} ans au moins après la sortie : l’identité et le titre de séjour figurent au registre unique du personnel (art. R1221-26).`
    : trop.length ? 'Aucune catégorie au-delà du dossier : son anonymisation efface tout.' : null;
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
        <span>Proposer les dossiers échus : Cursus liste chaque jour les dossiers des salariés sortis dont une durée est échue et prévient le service RH ; rien n’est effacé sans votre confirmation</span>
      </label>
      <Field label="Référence de la décision du DPO" htmlFor="param-conservation-dpo" requis={actif} erreur={tente && erreurDecision}>
        <input className="input" id="param-conservation-dpo" maxLength={120} placeholder="Décision du DPO du … sur les durées de conservation" value={decision}
          onChange={e => setDecision(e.target.value)} />
      </Field>
      <div className="grid-2">
        {CATEGORIES.map(c => (
          <Field key={c} label={CATEGORIES_CONSERVATION[c].label} htmlFor={`param-conservation-${c}`} erreur={tente && c === 'dossier' && erreurDurees}>
            <select className="input" id={`param-conservation-${c}`} value={durees[c]} onChange={e => setDurees({ ...durees, [c]: Number(e.target.value) })}>
              {ANS.map(n => <option key={n} value={n}>{ansTexte(n)}</option>)}
            </select>
          </Field>
        ))}
      </div>
      {modifie && (
        <div className="actions-end">
          <Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer les durées de conservation</Btn>
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
    <Panel title="Conservation des dossiers" aside={<Tag cls={active ? 'tag-neutral' : 'tag-outline'}>{active ? 'Propositions actives' : 'Inactive'}</Tag>} style={{ gap: 'var(--space-4)' }}>
      {!active && (
        <NoteAccent>
          Durées préremplies (références usuelles) mais inactives : aucun dossier n’est proposé tant que la case n’est pas cochée avec la référence de la
          décision du DPO. Rien n’est jamais effacé automatiquement.
        </NoteAccent>
      )}
      <Reglages s={s} />
      <Fine>
        Durées en années après le dernier jour du contrat. Chaque catégorie échue est effacée à part (passeport et visas, santé, titre de séjour,
        entretiens, textes libres et justificatifs du temps, motifs et pièces des formations) ; à l’échéance du dossier, la fiche est anonymisée
        (« Salarié anonymisé n° … ») et tout ce qui reste nominatif est effacé, jusqu’au nom dans le journal des actions. Les heures par projet, les
        absences, les coûts de formation et les lots de paie déjà transmis restent, sans nom. Les sauvegardes gardent les données effacées jusqu’à leur
        rotation.
      </Fine>

      <SectionLabel>Dossiers échus</SectionLabel>
      {!active ? <Empty pad="sm">Propositions inactives.</Empty> : !echus.length ? <Empty pad="sm">Aucun dossier échu.</Empty> : (
        <>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Tout sélectionner" checked={tous} onChange={() => setCoches(tous ? new Set() : new Set(echus.map(x => x.empId)))} style={{ accentColor: 'var(--color-accent)' }} /></th>
                  <th>Salarié</th><th>Sortie</th><th>À effacer</th><th>Éléments</th>
                </tr>
              </thead>
              <tbody>
                {echus.map(x => (
                  <tr key={x.empId}>
                    <td><input type="checkbox" aria-label={`Sélectionner ${d.emp(x.empId)?.nom ?? `le dossier n° ${x.empId}`}`} checked={coches.has(x.empId)} onChange={() => basculer(x.empId)} style={{ accentColor: 'var(--color-accent)' }} /></td>
                    <td>{d.emp(x.empId)?.nom ?? `n° ${x.empId}`}</td>
                    <td className="nowrap">{fmtIso(x.fin)}</td>
                    <td className="text-muted" style={{ fontSize: 13 }}>
                      {x.dossier ? <><Tag cls="tag-accent">Dossier à anonymiser</Tag> échu depuis le {fmtIso(echeanceConservation(x.fin, s.conservationDossierAns))}</>
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
              {coches.size ? `Effacer la sélection (${coches.size})…` : 'Effacer la sélection…'}
            </Btn>
          </div>
        </>
      )}

      <SectionLabel>Droit à l’effacement avant l’échéance</SectionLabel>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Salarié sorti qui demande l’effacement" htmlFor="param-conservation-demandeur">
          <select className="input" id="param-conservation-demandeur" value={demandeur} onChange={e => setDemandeur(e.target.value)} style={{ minWidth: 260 }}>
            <option value="">Choisir…</option>
            {sortis.map(e => <option key={e.id} value={e.id}>{e.nom} — sorti le {fmtIso(e.fin!)}</option>)}
          </select>
        </Field>
        <Btn disabled={!demandeur} onClick={() => openDialog({ type: 'anonymiser', ids: [Number(demandeur)], avantEcheance: true })}>Examiner la demande…</Btn>
      </div>
      <Fine>
        Une demande d’effacement (art. 17 du RGPD) s’examine avec le DPO. Le dossier d’un salarié en poste ne s’efface pas. Pour un salarié sorti,
        Cursus efface aussitôt ce qui ne relève d’aucune obligation légale (passeport et visas, entretiens, motifs et demandes des formations) et
        garde jusqu’à leur échéance l’identité et le titre de séjour (registre unique du personnel, 5 ans après le départ, art. R1221-26), la
        santé au travail et le temps de travail (art. 17-3-b du RGPD) ; le dialogue liste ce qui reste et jusqu’à quand.
      </Fine>
    </Panel>
  );
}
