// Paramètres → Jours fériés (t051, shared/rules/feries.ts) : journée de solidarité et fériés chômés, réglés année par année
// à partir de 2027, jamais pour une année passée. Par défaut : lundi de Pentecôte chômé, tous les fériés chômés. Le 1er mai
// reste toujours chômé. Avant d'enregistrer, l'écran nomme les absences dont le décompte change ; une année déjà engagée
// (absences transmises à la paie, congés clôturés) ne se modifie qu'avec un motif (dialogue « confirmer »). Réglage de
// l'administrateur RH (`parametres.feries`) ; les autres profils consultent.
import { useEffect, useMemo, useState } from 'react';
import { feriesLegaux, parse } from '../../../../shared/dates.ts';
import { fmtIso, fmtShort, plural } from '../../../../shared/format.ts';
import {
  absencesRecalculees, anneeEngagee, anneesReglables, controlerFeries, estEngagee, feriesDeLAnnee, ferieDuWeekEnd, FERIES_LABEL, memeReglage, MODALITES_SOLIDARITE, MOTIF_FERIES_MAX,
  reglageAnnee, SOLIDARITE_PAIE,
} from '../../../../shared/rules/feries.ts';
import type { CodeFerie, ModaliteSolidarite } from '../../../../shared/types.ts';
import { Field } from '../../components/Dialog.tsx';
import { Btn, Fine, Panel, Seg } from '../../components/ui.tsx';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import type { Confirmation } from '../../state/confirmations.ts';
import type { SectionProps } from './commun.ts';

const MODALITES = Object.entries(MODALITES_SOLIDARITE) as [ModaliteSolidarite, { label: string; aide: string }][];

export function Feries(_: SectionProps) {
  const d = useDomain();
  const { admin, espaceRh } = useRole();
  const { run, openDialog } = useStore();
  const annees = anneesReglables(d.ti);
  const [annee, setAnnee] = useState(annees[0]);
  const enVigueur = reglageAnnee(d.ds.calendrierFeries, annee);
  const [solidarite, setSolidarite] = useState<ModaliteSolidarite>(enVigueur.solidarite);
  const [ferie, setFerie] = useState<CodeFerie | ''>(enVigueur.solidariteFerie ?? '');
  const [nonChomes, setNonChomes] = useState<CodeFerie[]>(enVigueur.nonChomes);
  const [tente, setTente] = useState(false);
  const [busy, setBusy] = useState(false);
  const cle = JSON.stringify(enVigueur);
  useEffect(() => {
    const r = JSON.parse(cle) as typeof enVigueur;
    setSolidarite(r.solidarite); setFerie(r.solidariteFerie ?? ''); setNonChomes(r.nonChomes); setTente(false);
  }, [cle]);

  const saisi = { solidarite, solidariteFerie: solidarite === 'autre_ferie' ? (ferie || null) : null, nonChomes };
  // Contrôle partagé avec l'action : férié manquant, ou qui tombe un samedi ou un dimanche de l'année.
  const erreurFerie = solidarite === 'autre_ferie' ? controlerFeries({ annee, ...saisi }, d.ti).erreurs.solidariteFerie ?? null : null;
  const modifie = !memeReglage(enVigueur, saisi);
  const engagee = anneeEngagee(d.ds, annee);
  const cleSaisie = JSON.stringify(saisi);
  // Absences de l'année dont le décompte change (jours ouvrés) : nommées avant l'enregistrement.
  const recalculees = useMemo(() => (modifie && !erreurFerie ? absencesRecalculees(d, annee, JSON.parse(cleSaisie)) : []), [d, annee, cleSaisie, modifie, erreurFerie]);
  if (!espaceRh || !annees.length) return null;

  const legaux = feriesLegaux(annee);
  const sorts = feriesDeLAnnee(annee, { ...saisi, solidariteFerie: saisi.solidariteFerie as CodeFerie | null });
  const basculer = (c: CodeFerie, chome: boolean) => setNonChomes(chome ? nonChomes.filter(x => x !== c) : [...nonChomes, c]);
  const payload = { annee, ...saisi };
  const enregistrer = async () => {
    if (erreurFerie) { setTente(true); document.getElementById('feries-ferie')?.focus(); return; }
    if (estEngagee(engagee)) { openDialog({ type: 'confirmer', c: modificationEngagee(annee, engagee, recalculees.length, payload) }); return; }
    setBusy(true);
    await run('parametres.feries', payload);
    setBusy(false);
  };

  return (
    <Panel title="Jours fériés et journée de solidarité" style={{ gap: 'var(--space-4)' }}>
      <Field label="Année">
        <Seg name="feries-annee" label="Année" value={annee} options={annees.map(a => [a, String(a)] as [number, string])} onChange={setAnnee} />
      </Field>
      <Field label="Journée de solidarité" htmlFor="feries-solidarite">
        <select className="input" id="feries-solidarite" value={solidarite} disabled={!admin} onChange={e => { setSolidarite(e.target.value as ModaliteSolidarite); setTente(false); }} style={{ maxWidth: 360 }}>
          {MODALITES.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
      </Field>
      {solidarite === 'autre_ferie' && (
        <Field label="Jour férié travaillé" htmlFor="feries-ferie" requis erreur={(tente || !!ferie) && erreurFerie}>
          <select className="input" id="feries-ferie" value={ferie} disabled={!admin} onChange={e => setFerie(e.target.value as CodeFerie)} style={{ maxWidth: 360 }}>
            <option value="">Choisir…</option>
            {/* Férié du week-end : grisé, il ne ferait travailler aucun jour ouvré. */}
            {legaux.filter(f => f.code !== '1er_mai' && f.code !== 'pentecote').map(f => {
              const we = ferieDuWeekEnd(annee, f.code);
              return <option key={f.code} value={f.code} disabled={!!we && f.code !== ferie}>{FERIES_LABEL[f.code]} — {fmtIso(f.jour)}{we ? ` (${we})` : ''}</option>;
            })}
          </select>
        </Field>
      )}
      <Fine>{MODALITES_SOLIDARITE[solidarite].aide}</Fine>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <legend style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Fériés chômés en {annee}</legend>
        {sorts.map(f => (
          <label key={f.code} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: admin ? 'pointer' : undefined }}>
            <input type="checkbox" checked={f.sort === 'chome'} disabled={!admin || f.code === '1er_mai' || f.sort === 'solidarite'}
              onChange={e => basculer(f.code, e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
            <span>
              {FERIES_LABEL[f.code]} <span className="text-muted">· {fmtShort(parse(f.jour))}</span>
              {f.code === '1er_mai' && <span className="text-muted sub"> — toujours chômé et payé (art. L3133-4)</span>}
              {f.sort === 'solidarite' && <span className="text-muted sub"> — journée de solidarité, travaillée</span>}
              {f.sort === 'travaille' && <span className="text-muted sub"> — travaillé comme un jour ordinaire</span>}
            </span>
          </label>
        ))}
      </fieldset>

      {enVigueur.le && <Fine>Réglage {annee} enregistré le {fmtIso(enVigueur.le.slice(0, 10))} par {enVigueur.par}{enVigueur.motif ? ` — motif : ${enVigueur.motif}` : ''}.</Fine>}
      {modifie && recalculees.length > 0 && (
        <div className="note-accent">
          {plural(recalculees.length, 'absence recalculée', 'absences recalculées')} :{' '}
          {recalculees.slice(0, 8).map(x => `${d.personName(x.absence.empId)} du ${fmtShort(parse(x.absence.du))} (${x.avant} → ${x.apres} j)`).join(', ')}
          {recalculees.length > 8 ? '…' : ''}
        </div>
      )}
      {estEngagee(engagee) && (
        <div className="note-accent">
          Année {annee} déjà engagée ({engageeTexte(engagee)}) : une modification demande un motif, gardé pour le service RH.
        </div>
      )}
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{`Enregistrer ${annee}`}</Btn></div>}
      <Fine>
        Un férié non chômé, comme la journée de solidarité travaillée, devient un jour ordinaire : décompté dans les congés, heures proposées, jour de
        travail du forfait. {SOLIDARITE_PAIE} Le réglage d’une année ne change ni les années précédentes ni les décomptes d’avant la mise en service.
      </Fine>
    </Panel>
  );
}

const engageeTexte = (x: { absences: number; clotures: number }) => [
  x.absences ? plural(x.absences, 'absence transmise à la paie', 'absences transmises à la paie') : '',
  x.clotures ? plural(x.clotures, 'clôture de congés', 'clôtures de congés') : '',
].filter(Boolean).join(' et ');

/** Modification d'une année déjà engagée : motif obligatoire, absences recalculées annoncées. */
function modificationEngagee(annee: number, engagee: { absences: number; clotures: number }, recalculees: number, payload: Record<string, unknown>): Confirmation {
  return {
    titre: `Modifier les fériés ${annee}`,
    question: `Modifier les jours fériés de ${annee}, année déjà engagée (${engageeTexte(engagee)}) ?`,
    suites: [
      recalculees ? `${plural(recalculees, 'absence est recalculée', 'absences sont recalculées')} : ${recalculees > 1 ? 'leurs jours décomptés changent' : 'ses jours décomptés changent'} ; une absence déjà transmise part en régularisation au prochain lot.`
        : 'Aucune absence de l’année ne change de décompte.',
      'Les congés déjà clôturés ne sont pas refaits.',
    ],
    bouton: 'Enregistrer',
    action: 'parametres.feries',
    payload,
    motif: { label: 'Motif de la modification', requis: true, aide: `Gardé avec le réglage, lu par le service RH (${MOTIF_FERIES_MAX} caractères au plus) ; jamais recopié au journal.`, placeholder: 'Décision après avis du CSE du …' },
  };
}
