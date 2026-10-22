// Avenant de renonciation à des jours de repos d'un forfait jours (service RH, t043, art. L3121-59) : année, jours rachetés,
// taux de majoration, date de signature et référence. Ouvert seulement quand l'accord collectif est référencé dans
// Paramètres → Forfait jours. Les contrôles (plafond réglé, majoration minimale, signature) sont ceux du serveur
// (`erreursAvenant`, shared/rules/forfait-jours.ts), affichés champ par champ à l'envoi.
import { useState } from 'react';
import { fJ } from '../../../shared/format.ts';
import { isValidDate } from '../../../shared/dates.ts';
import {
  avenantsDe, cumulForfaitJours, erreursAvenant, MAJORATION_MINIMALE, periodeRachat, PLAFOND_SUPPLETIF, rachatOuvert, REFERENCE_AVENANT_MAX,
} from '../../../shared/rules/forfait-jours.ts';
import { periodeLabel } from '../../../shared/rules/paie.ts';
import { erreurDate } from '../components/controles.ts';
import { Bloquant, CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function AvenantForfaitDialog({ empId }: { empId: number }) {
  const d = useDomain();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = d.emp(empId);
  const s = d.ds.settings;
  const [annee, setAnnee] = useState(String(d.year));
  const [jours, setJours] = useState('');
  const [taux, setTaux] = useState(String(Math.max(s.forfaitJoursMajorationMin ?? MAJORATION_MINIMALE, 25)));
  const [signeLe, setSigneLe] = useState(d.ti);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const c = d.contratOf(emp);
  const an = Number(annee), n = Number(jours.replace(',', '.')), t = Number(taux);
  const deja = avenantsDe(d.ds.avenantsForfait, emp.id, an).reduce((x, a) => x + a.jours, 0);
  const plafond = s.forfaitJoursPlafond ?? PLAFOND_SUPPLETIF, max = plafond - c.joursForfait - deja;
  const k = cumulForfaitJours(d, emp, an);
  // Erreurs du serveur, rattachées à leur champ (l'ordre suit `erreursAvenant`).
  const erreurs = erreursAvenant(d, emp, { annee: an, jours: n, taux: t, signeLe, reference: reference.trim() });
  const de = (motif: RegExp) => erreurs.find(x => motif.test(x)) ?? null;
  const errJours = jours.trim() ? de(/^Jours rachetés/) : 'Indiquez le nombre de jours rachetés.';
  const errTaux = de(/^Majoration/);
  const errSigne = erreurDate(signeLe, 'Indiquez la date de signature de l’avenant.') ?? de(/signature|signé/i);
  const errAnnee = de(/^Année/);
  const errRef = de(/^Référence/);
  const errAutre = erreurs.filter(x => ![errJours, errTaux, errSigne, errAnnee, errRef].includes(x));

  const confirm = async () => {
    if (busy || !v.verifier(errJours, errTaux, errSigne, errAnnee, errRef, errAutre.length)) return;
    setBusy(true);
    const r = await run('forfait.avenant', { empId: emp.id, annee: an, jours: n, taux: t, signeLe, reference: reference.trim() || null });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Avenant de renonciation à des jours de repos" width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer l’avenant</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom}</Static></Field>
        <Field label="Forfait">
          <Static>{c.joursForfait} jours<div className="text-muted sub">{k ? `${fJ(k.done)} travaillés en ${k.annee}` : 'aucune feuille validée cette année-là'}{deja ? ` · ${fJ(deja)} déjà rachetés` : ''}</div></Static>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Année" htmlFor="af-annee" requis erreur={v.erreur(errAnnee)}>
          <select className="input" id="af-annee" value={annee} onChange={ev => setAnnee(ev.target.value)}>
            {[d.year - 1, d.year, d.year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Jours rachetés" htmlFor="af-jours" requis erreur={v.erreur(errJours)}>
          <input className="input tnum" id="af-jours" inputMode="decimal" placeholder={max > 0 ? `${fJ(max)} au plus` : ''} value={jours} onChange={ev => setJours(ev.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Majoration (%)" htmlFor="af-taux" requis erreur={v.erreur(errTaux)}>
          <input className="input tnum" id="af-taux" inputMode="numeric" value={taux} onChange={ev => setTaux(ev.target.value)} />
        </Field>
        <Field label="Avenant signé le" htmlFor="af-signe" requis erreur={v.erreur(errSigne)}>
          <input className="input" id="af-signe" type="date" min={emp.entree} max={d.ti} value={signeLe} onChange={ev => setSigneLe(ev.target.value)} />
        </Field>
      </div>
      <Field label={<>Référence de l’avenant <span className="who">· facultatif</span></>} htmlFor="af-ref" erreur={v.erreur(errRef)}>
        <input className="input" id="af-ref" type="text" maxLength={REFERENCE_AVENANT_MAX + 20} placeholder="Avenant forfait jours du …" value={reference} onChange={ev => setReference(ev.target.value)} />
        <span className="text-muted sub">Gardée sur l’avenant (service RH, paie) ; jamais recopiée au journal</span>
      </Field>
      {v.tente && errAutre.map(x => <Bloquant key={x}>{x}</Bloquant>)}
      <Fine>
        Avenant écrit, valable pour l’année (art. L3121-59) : le salarié renonce à des jours de repos contre une majoration d’au moins
        {` ${s.forfaitJoursMajorationMin ?? MAJORATION_MINIMALE} %`}. Le plafond de l’année devient le forfait plus les jours rachetés, {plafond} jours
        travaillés au plus{rachatOuvert(s) ? ` (accord : ${s.forfaitJoursAccord})` : ''}. Paie : rubrique JREN, quantité en jours{isValidDate(signeLe) ? `, paie ${/^[aeiou]/.test(periodeLabel(periodeRachat({ annee: an, signeLe }, s, d.ti))) ? 'd’' : 'de '}${periodeLabel(periodeRachat({ annee: an, signeLe }, s, d.ti))}` : ''} ; Sage calcule le montant.
      </Fine>
    </Dialog>
  );
}
