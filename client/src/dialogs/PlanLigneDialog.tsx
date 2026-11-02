// Correction d'une ligne du plan de formation saisie par erreur (`plan.modifier`, service RH) : formation du catalogue ou
// intitulé hors catalogue, équipe, trimestre, effectif et coût prévus, motif obligatoire. Ligne prévue ou engagée d'un
// exercice ouvert ; une ligne rattachée à une session ouverte garde sa formation (contrôles de shared/rules/corrections.ts).
import { useState } from 'react';
import { fmtEur } from '../../../shared/format.ts';
import { erreursLignePlan, LIBELLE_PLAN_MAX, MOTIF_CORRECTION_MAX, sessionsDeLaLigne, TRIMESTRES } from '../../../shared/rules/corrections.ts';
import { PLAN_LABEL } from '../../../shared/constants.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
// lot 12 — C4 (organismes de formation et e-learning) : organisme prévu et tarif en vigueur (proposé, jamais imposé).
import { ChoixOrganisme } from '../components/organismes/ChoixOrganisme.tsx';
import { organismeDeFormation, tarifEnVigueur, UNITES_TARIF } from '../../../shared/rules/organismes.ts';
import { Btn } from '../components/ui.tsx';

/** Valeur du sélecteur de formation pour une action hors catalogue. */
const HORS = '';

export function PlanLigneDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const l = d.ds.plan.find(x => x.id === id);
  const [f, setF] = useState(l?.f ?? HORS);
  const [libelle, setLibelle] = useState(l?.libelle ?? '');
  const [equipe, setEquipe] = useState(l?.equipe ?? '');
  const [periode, setPeriode] = useState<string>(l?.periode ?? 'T1');
  const [effectif, setEffectif] = useState(l ? String(l.effectif) : '');
  const [cout, setCout] = useState(l ? String(l.cout) : '');
  const [motif, setMotif] = useState('');
  // lot 12 — C4 : organisme prévu ('' : celui du catalogue).
  const [organismeId, setOrganismeId] = useState(l?.organismeId != null ? String(l.organismeId) : '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!l) return null;
  // lot 12 — C4 : tarif en vigueur de l'organisme retenu pour la formation, au début du trimestre (ou aujourd'hui).
  const fiche = organismeId ? (d.ds.organismes ?? []).find(o => o.id === Number(organismeId)) ?? null
    : f ? organismeDeFormation(d.ds, d.ds.referentiels.formations.find(x => x.id === f)) : null;
  const debut = `${l.exercice}-${String((Number(periode.slice(1)) - 1) * 3 + 1).padStart(2, '0')}-01`;
  const tarif = fiche && f ? tarifEnVigueur(d.ds.organismeTarifs, fiche.id, f, debut > d.ti ? debut : d.ti) : null;
  const coutTarif = tarif ? Math.round(tarif.montantHt * (tarif.unite === 'stagiaire' || tarif.unite === 'licence' ? Number(effectif) || 0 : 1) * 100) / 100 : null;
  const catalogue = f ? organismeDeFormation(d.ds, d.ds.referentiels.formations.find(x => x.id === f)) : null;
  // Formations du catalogue en vigueur, et celle de la ligne même archivée depuis.
  const formations = d.ds.referentiels.formations.filter(x => !x.archive || x.id === l.f);
  const equipes = d.equipes.includes(l.equipe) ? d.equipes : [l.equipe, ...d.equipes];
  const e = erreursLignePlan(d, l, { f: f || null, libelle, equipe, periode, effectif: effectif.trim(), cout: cout.trim().replace(/\s/g, '') });
  const motifErr = !motif.trim() ? 'Indiquez le motif de la correction.' : null;
  const session = sessionsDeLaLigne(d, l)[0];

  const envoyer = async () => {
    if (busy || !v.verifier(e.formation, e.equipe, e.periode, e.effectif, e.cout, motifErr)) return;
    setBusy(true);
    const r = await run('plan.modifier', {
      id: l.id, f: f || null, libelle: f ? undefined : libelle.trim(), equipe, periode, effectif: effectif.trim(), cout: cout.trim().replace(/\s/g, '').replace(',', '.'), motif: motif.trim(),
      // lot 12 — C4 : seulement s'il change (une autre formation sans choix retombe sur son catalogue).
      ...(organismeId !== (l.organismeId != null ? String(l.organismeId) : '') ? { organismeId } : {}),
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Corriger l’action du plan" width={560} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer la correction</SubmitButton>
    </>}>
      <Field label="Formation" htmlFor="pl-f" requis erreur={v.erreur(e.formation) || (f !== (l.f ?? HORS) ? e.formation : null)}>
        <select className="input" id="pl-f" value={f} onChange={ev => setF(ev.target.value)} disabled={!!session}>
          {formations.map(o => <option key={o.id} value={o.id}>{o.nom}</option>)}
          <option value={HORS}>Hors catalogue</option>
        </select>
      </Field>
      {!f && (
        <Field label="Intitulé" htmlFor="pl-libelle" requis erreur={v.erreur(e.formation)}>
          <input className="input" id="pl-libelle" maxLength={LIBELLE_PLAN_MAX} value={libelle} onChange={ev => setLibelle(ev.target.value)} />
        </Field>
      )}
      <div className="grid-2">
        <Field label="Équipe" htmlFor="pl-equipe" requis erreur={v.erreur(e.equipe)}>
          <select className="input" id="pl-equipe" value={equipe} onChange={ev => setEquipe(ev.target.value)}>
            {equipes.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </Field>
        <Field label="Trimestre" htmlFor="pl-periode" requis erreur={v.erreur(e.periode)}>
          <select className="input" id="pl-periode" value={periode} onChange={ev => setPeriode(ev.target.value)}>
            {TRIMESTRES.map(t => <option key={t} value={t}>{t} {l.exercice}</option>)}
          </select>
        </Field>
        <Field label="Effectif prévu" htmlFor="pl-effectif" requis erreur={v.erreur(e.effectif) || (effectif.trim() ? e.effectif : null)}>
          <input className="input tnum" id="pl-effectif" inputMode="numeric" value={effectif} onChange={ev => setEffectif(ev.target.value)} />
        </Field>
        <Field label="Coût prévu (€)" htmlFor="pl-cout" requis erreur={v.erreur(e.cout) || (cout.trim() ? e.cout : null)}>
          <input className="input tnum" id="pl-cout" inputMode="decimal" value={cout} onChange={ev => setCout(ev.target.value)} />
        </Field>
      </div>
      {/* lot 12 — C4 : organisme prévu (avertissements Qualiopi au début du trimestre) et tarif en vigueur proposé. */}
      <ChoixOrganisme id="pl-organisme" valeur={organismeId} onChange={setOrganismeId} actuel={l.organismeId ?? null} label="Organisme prévu"
        vide={catalogue ? `Celui du catalogue (${catalogue.nomUsuel})` : 'Celui du catalogue'} le={debut > d.ti ? debut : d.ti} />
      {tarif && coutTarif != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className="text-muted sub">Tarif en vigueur : {fmtEur(tarif.montantHt)} {UNITES_TARIF[tarif.unite]}{coutTarif !== tarif.montantHt ? `, soit ${fmtEur(coutTarif)}` : ''}.</span>
          {String(coutTarif) !== cout.trim().replace(',', '.') && <Btn small onClick={() => setCout(String(coutTarif))}>Reprendre ce coût</Btn>}
        </div>
      )}
      <Field label="Motif de la correction" htmlFor="pl-motif" requis erreur={v.erreur(motifErr)}>
        <textarea className="input mid" id="pl-motif" rows={2} maxLength={MOTIF_CORRECTION_MAX} placeholder="Erreur de trimestre à l’import, effectif revu…"
          value={motif} onChange={ev => setMotif(ev.target.value)} />
      </Field>
      <Fine>
        {PLAN_LABEL[l.statut]} · {l.exercice} · actuellement {fmtEur(l.cout)} pour {l.effectif} pers.
        {session ? ' Une session est rattachée à cette action : sa formation ne change plus.' : ''} La correction est datée et signée ; le motif reste au service RH.
      </Fine>
    </Dialog>
  );
}
