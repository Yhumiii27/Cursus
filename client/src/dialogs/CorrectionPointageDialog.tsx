// Badgeage virtuel (lot 12, chantier C6, étape 2) : demande de correction d'un pointage (`pointage.corriger`) — ajout d'un
// pointage oublié (jour, heure de Paris, arrivée ou départ) ou retrait d'un pointage erroné (`pointageId`). Motif tiré
// d'une liste fermée, commentaire facultatif (jamais recopié au journal). Le salarié la demande pour lui-même sous le délai
// réglé ; son valideur (manager, suppléant « feuilles », service RH) la saisit pour lui, validée d'emblée. Contrôles du
// serveur : server/src/actions/pointage.ts ; règles : shared/rules/pointage.ts.
import { useState } from 'react';
import { addD } from '../../../shared/dates.ts';
import { fmtIso } from '../../../shared/format.ts';
import { normaliserHeure } from '../../../shared/rules/horaires.ts';
import { instantParis, MOTIFS_CORRECTION, refusDelaiCorrection, TEXTE_CORRECTION_MAX } from '../../../shared/rules/pointage.ts';
import type { ISODate, MotifCorrectionPointage, SensPointage } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine, Seg } from '../components/ui.tsx';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const SENS: [SensPointage, string][] = [['E', 'Arrivée'], ['S', 'Départ']];

export function CorrectionPointageDialog({ empId, nature, pointageId, jour: jourInitial, heure: heureVisee, sens: sensVise }: {
  empId: number; nature: 'ajout' | 'neutralisation'; pointageId?: number; jour?: ISODate; heure?: string; sens?: SensPointage;
}) {
  const d = useDomain();
  const { rh, me } = useRole();
  const { run, closeDialog } = useStore();
  const e = d.emp(empId);
  const soi = empId === me;
  const delai = d.ds.settings.pointageDelaiCorrectionJours;
  const [jour, setJour] = useState<string>(jourInitial ?? d.ti);
  const [heure, setHeure] = useState('');
  const [sens, setSens] = useState<SensPointage>('E');
  const [motif, setMotif] = useState<MotifCorrectionPointage | ''>('');
  const [commentaire, setCommentaire] = useState('');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  if (!e) return null;

  const ajout = nature === 'ajout';
  const h = normaliserHeure(heure);
  // Délai : le salarié et son manager ; le service RH corrige sans délai (règle du serveur).
  const refusJour = ajout ? (!jour ? 'Indiquez le jour du pointage oublié.' : refusDelaiCorrection(jour, d.ti, delai, rh && !soi)) : null;
  const erreurHeure = ajout ? (!heure.trim() ? 'Indiquez l’heure du pointage oublié (8:00, 17 h 30…).' : !h ? 'Heure invalide : 8:00, 17 h 30…' : null) : null;
  const erreurMotif = !motif ? 'Choisissez le motif de la correction.' : null;
  const erreurCommentaire = commentaire.trim().length > TEXTE_CORRECTION_MAX ? `${TEXTE_CORRECTION_MAX} caractères au plus.` : null;

  const envoyer = async () => {
    if (busy || !v.verifier(refusJour, erreurHeure, erreurMotif, erreurCommentaire)) return;
    setBusy(true);
    const base = { empId, nature, motif, commentaire: commentaire.trim() };
    const payload = ajout
      ? { ...base, horodatage: new Date(instantParis(jour, Number(h!.slice(0, 2)) * 60 + Number(h!.slice(3, 5)))).toISOString(), sens }
      : { ...base, pointageId };
    const r = await run('pointage.corriger', payload);
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={ajout ? (soi ? 'Signaler un pointage oublié' : 'Ajouter un pointage') : 'Retirer un pointage'} width={520} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{soi ? 'Envoyer la demande' : 'Enregistrer la correction'}</SubmitButton>
    </>}>
      {!soi && <Field label="Collaborateur"><Static>{e.nom}</Static></Field>}
      {ajout ? <>
        <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
          <Field label="Jour" htmlFor="cp-jour" requis erreur={v.erreur(refusJour)}>
            <input className="input" id="cp-jour" type="date" value={jour} min={rh && !soi ? undefined : addD(d.ti, -delai)} max={d.ti} onChange={x => setJour(x.target.value)} style={{ maxWidth: 200 }} />
          </Field>
          <Field label="Heure" htmlFor="cp-heure" requis erreur={v.erreur(erreurHeure)}>
            <input className="input tnum" id="cp-heure" type="text" inputMode="numeric" autoFocus value={heure} maxLength={8} placeholder="08:00" onChange={x => setHeure(x.target.value)} style={{ maxWidth: 120 }} />
          </Field>
        </div>
        <Field label="Sens">
          <Seg name="cp-sens" label="Sens du pointage" value={sens} options={SENS} onChange={setSens} />
        </Field>
      </> : (
        <Field label="Pointage à retirer"><Static>{jourInitial ? fmtIso(jourInitial) : ''}{heureVisee ? ` à ${heureVisee}` : ''}{sensVise ? ` · ${sensVise === 'S' ? 'départ' : 'arrivée'}` : ''}</Static></Field>
      )}
      <Field label="Motif" htmlFor="cp-motif" requis erreur={v.erreur(erreurMotif)}>
        <select className="input" id="cp-motif" value={motif} onChange={x => setMotif(x.target.value as MotifCorrectionPointage | '')}>
          <option value="">Choisir…</option>
          {Object.entries(MOTIFS_CORRECTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Commentaire (facultatif)" htmlFor="cp-commentaire" erreur={erreurCommentaire}>
        <textarea className="input" id="cp-commentaire" rows={2} value={commentaire} maxLength={TEXTE_CORRECTION_MAX + 50} onChange={x => setCommentaire(x.target.value)}
          placeholder="Badge du téléphone non chargé à l’arrivée…" />
      </Field>
      <Fine>
        {soi
          ? `Demande validée par votre manager (ou son suppléant) ou par le service RH, sous ${delai} jours après le pointage. `
          : 'Saisie par vous, la correction est validée d’emblée ; le salarié en voit l’origine. '}
        Le commentaire n’est jamais recopié au journal : n’y indiquez aucune information médicale. Une semaine dont la feuille est validée se corrige après sa réouverture.
      </Fine>
    </Dialog>
  );
}
