// Avis du médecin du travail (service RH) : date de la visite, avis (apte, apte avec restrictions, inapte),
// restrictions recopiées telles qu'écrites et datées, habilitations incompatibles à suspendre, suspensions d'un
// avis précédent à lever. La visite clôt la demande en cours ; le manager ne voit que le verdict et les restrictions.
import { useState } from 'react';
import { HAB_CLS, HAB_LABEL } from '../../../shared/constants.ts';
import { fmtIso } from '../../../shared/format.ts';
import { controlerAvis, RESTRICTION_MAX, RESTRICTIONS_MAX, suspendueParAvis } from '../../../shared/rules/sante.ts';
import type { AvisMedical } from '../../../shared/types.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, SectionLabel, Seg, Tag } from '../components/ui.tsx';
import { useEnriched, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

interface Ligne { texte: string; jusquau: string }
const LIGNE_VIDE: Ligne = { texte: '', jusquau: '' };

export function AvisDialog({ empId }: { empId: number }) {
  const { d, emps } = useEnriched();
  const { rh } = useRole();
  const { run, closeDialog } = useStore();
  const emp = emps.find(e => e.id === empId);
  const titres = emp ? emp.habs.filter(h => h.delivree && h.mesure !== 'retrait') : [];
  const [date, setDate] = useState(d.ti);
  const [avis, setAvisState] = useState<AvisMedical>('apte');
  const [lignes, setLignes] = useState<Ligne[]>([LIGNE_VIDE]);
  const [suspendre, setSuspendre] = useState<string[]>([]);
  // Avis apte : les suspensions décidées à un avis précédent sont levées par défaut.
  const [lever, setLever] = useState<string[]>(() => titres.filter(suspendueParAvis).map(h => h.h));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!emp || !rh) return null;

  const setAvis = (a: AvisMedical) => {
    setAvisState(a);
    setSuspendre([]);
    setLever(a === 'apte' ? titres.filter(suspendueParAvis).map(h => h.h) : []);
  };
  const setLigne = (i: number, patch: Partial<Ligne>) => setLignes(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  const bascule = (liste: string[], set: (v: string[]) => void, h: string, on: boolean) => set(on ? [...liste, h] : liste.filter(x => x !== h));

  const { errors } = controlerAvis({ date, avis, restrictions: lignes }, d.ti);
  const demande = emp.med.demande;
  const infos = [
    ...(emp.visite && date && date < emp.visite ? [`Visite antérieure à la dernière enregistrée (${fmtIso(emp.visite)}) : cet avis la remplace.`] : []),
    ...(demande ? [date >= demande.le ? `La demande de visite du ${fmtIso(demande.le)} sera close.` : `La demande de visite du ${fmtIso(demande.le)} reste en cours (visite antérieure).`] : []),
  ];
  // Erreurs affichées après la première tentative d'envoi ; les informations, en direct.
  const msgs = [...(v.tente ? errors : []).map(text => ({ text, bad: true })), ...infos.map(text => ({ text, bad: false }))];

  const confirm = async () => {
    if (busy || !v.verifier(...errors)) return;
    setBusy(true);
    const r = await run('medical.avis', {
      empId, date, avis, restrictions: avis === 'restrictions' ? lignes : [],
      suspendre: avis === 'apte' ? [] : suspendre, lever: avis === 'inapte' ? [] : lever,
    });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Avis du médecin du travail" width={640} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer l’avis</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label="Collaborateur"><Static>{emp.nom} · {emp.poste}</Static></Field>
        <Field label="Date de la visite" htmlFor="av-date">
          <input className="input" id="av-date" type="date" max={d.ti} value={date} onChange={ev => setDate(ev.target.value)} />
        </Field>
      </div>
      <div className="boxed text-muted sub">Actuellement : {emp.med.text}</div>
      <Field label="Avis">
        <Seg name="av-avis" label="Avis du médecin du travail" value={avis} onChange={setAvis} style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}
          options={[['apte', 'Apte'], ['restrictions', 'Apte avec restrictions'], ['inapte', 'Inapte']]} />
      </Field>

      {avis === 'restrictions' && <>
        <SectionLabel>Restrictions et aménagements de poste</SectionLabel>
        {lignes.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <Field label={`Restriction ${i + 1}, telle qu’écrite sur l’avis`} htmlFor={`av-r${i}`}>
                <input className="input" id={`av-r${i}`} type="text" maxLength={RESTRICTION_MAX} placeholder="Pas de port de charges de plus de 15 kg"
                  value={l.texte} onChange={ev => setLigne(i, { texte: ev.target.value })} />
              </Field>
            </div>
            <div style={{ flex: '0 1 170px' }}>
              <Field label="Jusqu’au (facultatif)" htmlFor={`av-j${i}`}>
                <input className="input" id={`av-j${i}`} type="date" min={date || undefined} value={l.jusquau} onChange={ev => setLigne(i, { jusquau: ev.target.value })} />
              </Field>
            </div>
            {lignes.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLignes(ls => ls.filter((_, j) => j !== i))}>Retirer</button>}
          </div>
        ))}
        {lignes.length < RESTRICTIONS_MAX && (
          <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLignes(ls => [...ls, LIGNE_VIDE])}>Ajouter une restriction</button></div>
        )}
        <Fine>Recopiez chaque restriction telle qu’écrite, sans diagnostic ni motif médical : le manager la voit, avec sa date de fin. L’avis lui-même n’est pas conservé dans Cursus.</Fine>
      </>}

      {titres.length > 0 && <>
        <SectionLabel>Habilitations</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {titres.map(h => {
            const parAvis = suspendueParAvis(h);
            // Inapte : les titres qui exigent l'aptitude deviennent non valides d'office (prérequis).
            const doffice = avis === 'inapte' && h.hm.medical && !h.mesure;
            const choix = parAvis
              ? (avis !== 'inapte' && { label: 'Lever la suspension', on: lever.includes(h.h), set: (on: boolean) => bascule(lever, setLever, h.h, on) })
              : (!h.mesure && avis !== 'apte' && !doffice && { label: 'Suspendre (incompatible)', on: suspendre.includes(h.h), set: (on: boolean) => bascule(suspendre, setSuspendre, h.h, on) });
            return (
              <div key={h.h} className="boxed" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{h.hm.nom}</div>
                  <div className="text-muted sub">
                    {doffice ? 'Non valide d’office : exige l’aptitude médicale' : h.mesure ? h.note : h.hm.medical ? 'Exige l’aptitude médicale' : 'Sans condition d’aptitude'}
                  </div>
                </div>
                {choix
                  ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer', flex: 'none' }}>
                      <input type="checkbox" checked={choix.on} onChange={ev => choix.set(ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                      {choix.label}
                    </label>
                  )
                  : <Tag cls={HAB_CLS[h.key]} style={{ flex: 'none' }}>{HAB_LABEL[h.key]}</Tag>}
              </div>
            );
          })}
        </div>
        <Fine>
          Une habilitation suspendue porte le motif « Restriction d’aptitude », sans autre détail ; les chantiers qui l’exigent passent en No Go.
          {avis === 'apte' ? ' Avis apte : les suspensions décidées à un avis précédent peuvent être levées.' : ''}
        </Fine>
      </>}

      <Controles msgs={msgs} />
      <Fine>Keystone ne reçoit que le verdict (code APTITUDE) : No Go pour un avis d’inaptitude, réserve pendant des restrictions en vigueur ou une visite en retard.</Fine>
    </Dialog>
  );
}
