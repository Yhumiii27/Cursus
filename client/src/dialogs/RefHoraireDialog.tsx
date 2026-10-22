// Écran Référentiels, onglet Horaires : nouvel horaire de poste (code choisi une fois pour toutes) ou modification du
// libellé, des heures de début et de fin et de la pause. Contrôles partagés avec le serveur (shared/rules/horaires.ts).
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import { controlerHoraire, dureeHoraire, finitLeLendemain, horairesDe, NOM_HORAIRE_MAX, normaliserHeure, PAUSE_MAX } from '../../../shared/rules/horaires.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function RefHoraireDialog({ code }: { code?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const horaires = horairesDe(d.ds.referentiels);
  const [avant] = useState(() => (code ? horaires.find(h => h.code === code) ?? null : null));
  const [saisi, setSaisi] = useState('');
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [debut, setDebut] = useState(avant?.debut ?? '');
  const [fin, setFin] = useState(avant?.fin ?? '');
  const [pause, setPause] = useState(String(avant?.pause ?? 0));
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !!code && !avant;
  const { erreurs, horaire } = controlerHoraire({ code: saisi, nom, debut, fin, pause }, horaires, avant);
  // Code déjà pris ou mal formé : dès la saisie ; champ vide : à l'envoi.
  const tape = (s: string, e: string | undefined) => (s.trim() ? e ?? null : v.erreur(e));

  const envoyer = async () => {
    if (busy || !v.verifier(avant ? null : erreurs.code, erreurs.nom, erreurs.debut, erreurs.fin, erreurs.pause, disparu)) return;
    setBusy(true);
    const champs = { nom, debut, fin, pause };
    const r = await run('referentiel.horaire.enregistrer', avant ? { id: avant.code, ...champs } : { code: saisi, ...champs });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const d0 = normaliserHeure(debut), f0 = normaliserHeure(fin);
  return (
    <Dialog title={avant ? `Horaire ${avant.code}` : 'Nouvel horaire de poste'} width={500} onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton>
      </>}>
      {disparu ? <Bloquant>Cet horaire n’existe plus.</Bloquant> : <>
        {!avant && (
          <Field label="Code" htmlFor="rhor-code" requis erreur={tape(saisi, erreurs.code)}>
            <input className="input" id="rhor-code" type="text" autoFocus value={saisi} maxLength={6} placeholder="M"
              onChange={e => setSaisi(e.target.value.toUpperCase())} style={{ maxWidth: 140 }} />
          </Field>
        )}
        <Field label="Libellé" htmlFor="rhor-nom" requis erreur={tape(nom, erreurs.nom)}>
          <input className="input" id="rhor-nom" type="text" autoFocus={!!avant} value={nom} maxLength={NOM_HORAIRE_MAX} placeholder="Équipe du matin"
            onChange={e => setNom(e.target.value)} />
        </Field>
        <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
          <Field label="Début" htmlFor="rhor-debut" requis erreur={tape(debut, erreurs.debut)}>
            <input className="input tnum" id="rhor-debut" type="text" inputMode="numeric" value={debut} maxLength={8} placeholder="05:00"
              onChange={e => setDebut(e.target.value)} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Fin" htmlFor="rhor-fin" requis erreur={tape(fin, erreurs.fin)}>
            <input className="input tnum" id="rhor-fin" type="text" inputMode="numeric" value={fin} maxLength={8} placeholder="13:00"
              onChange={e => setFin(e.target.value)} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Pause (minutes)" htmlFor="rhor-pause" erreur={erreurs.pause ?? null}>
            <input className="input tnum" id="rhor-pause" type="text" inputMode="numeric" value={pause} maxLength={3} placeholder="30"
              onChange={e => setPause(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 120 }} />
          </Field>
        </div>
        {horaire && (
          <Fine>
            {fH(dureeHoraire(horaire))} de travail{finitLeLendemain(horaire) ? ', fin le lendemain (poste de nuit)' : ''}.
          </Fine>
        )}
        {!horaire && d0 && f0 && d0 !== f0 && <Fine>Une fin antérieure au début finit le lendemain (poste de nuit).</Fine>}
        <Fine>
          Le code désigne l’horaire sur les feuilles de temps et ne change plus. Pause de 0 à {PAUSE_MAX} minutes. Une feuille soumise garde l’horaire
          retenu avec ses heures du moment : modifier les heures ne change que les feuilles encore en saisie et les suivantes.
        </Fine>
      </>}
    </Dialog>
  );
}
