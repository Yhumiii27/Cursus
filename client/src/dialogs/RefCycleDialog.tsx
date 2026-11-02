// Planning d'équipe (lot 12, chantier C5, étape 2) : Référentiels → Cycles et Besoins de poste (service RH). Un cycle de
// roulement : code choisi une fois pour toutes, libellé, séquence des horaires jour par jour (un code d'horaire en vigueur,
// ou « - » pour un repos), groupes et leur décalage, jour d'origine ; indicateurs calculés en direct (heures moyennes par
// semaine, nuits, dimanches, alertes à 44 h). Un besoin de poste : équipe, horaire, jours de la semaine, effectif minimal,
// exigences propres au créneau, période. Contrôles partagés avec le serveur (shared/rules/cycles.ts, planning.ts).
import { useState } from 'react';
import { fH } from '../../../shared/format.ts';
import { reglagesNuit } from '../../../shared/rules/repos-nuit.ts';
import { controlerCycle, cycleDe, GROUPES_MAX, indicateursCycle, LONGUEUR_MAX, NOM_CYCLE_MAX, ORIGINE_MODELES } from '../../../shared/rules/cycles.ts';
import { horairesDe, horairesEnVigueur } from '../../../shared/rules/horaires.ts';
import { controlerBesoin } from '../../../shared/rules/planning.ts';
import type { Exigences } from '../../../shared/types.ts';
import { ExigencesChoix } from '../components/ExigencesChoix.tsx';
import { Bloquant, CancelButton, Controles, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

/** Jours de la semaine des besoins (0 = lundi … 6 = dimanche). */
export const JOURS_BESOIN = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'] as const;

/** Séquence saisie : codes séparés par des espaces ou des virgules, « - » pour un repos. */
export const lireSequence = (texte: string): string[] => texte.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean).map(x => (x === '-' || x === 'R' ? '' : x));
/** Séquence affichée : « M M AM - - ». */
export const ecrireSequence = (s: readonly (string | null)[]) => s.map(x => x || '-').join(' ');
/** Groupes saisis : « A:0 B:7 C:14 ». */
export const lireGroupes = (texte: string) => texte.split(/[\s,;]+/).filter(Boolean).map(x => { const [code, dec] = x.split(':'); return { code: (code ?? '').toUpperCase(), decalage: Number(dec ?? 0) }; });
export const ecrireGroupes = (g: readonly { code: string; decalage: number }[]) => g.map(x => `${x.code}:${x.decalage}`).join(' ');

export function RefCycleDialog({ code }: { code?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const cycles = d.ds.cycles ?? [];
  const [avant] = useState(() => (code ? cycleDe(cycles, code) : null));
  const [saisi, setSaisi] = useState('');
  const [nom, setNom] = useState(avant?.nom ?? '');
  const [sequence, setSequence] = useState(avant ? ecrireSequence(avant.sequence) : '');
  const [groupes, setGroupes] = useState(avant ? ecrireGroupes(avant.groupes) : 'A:0');
  const [origine, setOrigine] = useState(avant?.origine ?? ORIGINE_MODELES);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = !!code && !avant;
  const seq = lireSequence(sequence);
  const p = { code: saisi, nom, longueur: seq.length, sequence: seq, groupes: lireGroupes(groupes), origine };
  const { erreurs, valeurs } = controlerCycle(p, cycles, horairesDe(d.ds.referentiels), avant);
  const ind = valeurs ? indicateursCycle(valeurs, horairesDe(d.ds.referentiels), reglagesNuit(d.ds.settings)) : null;
  const tape = (s: string, e: string | undefined) => (s.trim() ? e ?? null : v.erreur(e));

  const envoyer = async () => {
    if (busy || !v.verifier(avant ? null : erreurs.code, erreurs.nom, erreurs.longueur, erreurs.sequence, erreurs.groupes, erreurs.origine, disparu)) return;
    setBusy(true);
    const r = await run(avant ? 'planning.cycle.modifier' : 'planning.cycle.creer', avant ? { ...p, code: avant.code } : p);
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={avant ? `Cycle ${avant.code}` : 'Nouveau cycle de roulement'} width={600} onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter au référentiel'}</SubmitButton></>}>
      {disparu ? <Bloquant>Ce cycle n’existe plus.</Bloquant> : <>
        {!avant && (
          <Field label="Code" htmlFor="cyc-code" requis erreur={tape(saisi, erreurs.code)}>
            <input className="input" id="cyc-code" autoFocus value={saisi} maxLength={8} placeholder="3X8" onChange={e => setSaisi(e.target.value.toUpperCase())} style={{ maxWidth: 140 }} />
          </Field>
        )}
        <Field label="Libellé" htmlFor="cyc-nom" requis erreur={tape(nom, erreurs.nom)}>
          <input className="input" id="cyc-nom" autoFocus={!!avant} value={nom} maxLength={NOM_CYCLE_MAX} placeholder="3x8 : matin, après-midi, nuit" onChange={e => setNom(e.target.value)} />
        </Field>
        <Field label="Séquence, jour par jour" htmlFor="cyc-seq" requis erreur={tape(sequence, erreurs.longueur ?? erreurs.sequence)}>
          <textarea className="input short" id="cyc-seq" rows={2} value={sequence} placeholder="M M M M M - - AM AM AM AM AM - -" onChange={e => setSequence(e.target.value)} style={{ resize: 'vertical' }} />
          <span className="text-muted sub">
            Un code d’horaire en vigueur ({horairesEnVigueur(d.ds.referentiels).map(h => h.code).join(', ') || 'aucun'}) ou « - » pour un repos, séparés par des espaces ;
            {` ${seq.length} jour${seq.length > 1 ? 's' : ''}`} (au plus {LONGUEUR_MAX}).
          </span>
        </Field>
        <div className="grid-2">
          <Field label="Groupes et décalages" htmlFor="cyc-groupes" requis erreur={tape(groupes, erreurs.groupes)}>
            <input className="input" id="cyc-groupes" value={groupes} placeholder="A:0 B:7 C:14" onChange={e => setGroupes(e.target.value)} />
            <span className="text-muted sub">Code du groupe et décalage en jours sur la séquence ; {GROUPES_MAX} groupes au plus.</span>
          </Field>
          <Field label="Jour d’origine" htmlFor="cyc-origine" requis erreur={v.erreur(erreurs.origine)}>
            <input className="input" id="cyc-origine" type="date" value={origine} onChange={e => setOrigine(e.target.value)} />
            <span className="text-muted sub">Premier jour de la séquence du groupe de décalage 0 (un lundi, de préférence).</span>
          </Field>
        </div>
        {ind && (
          <Fine muted={false}>
            {fH(ind.heuresSemaine)} par semaine en moyenne · {ind.nuitsSemaine.toLocaleString('fr-FR')} poste{ind.nuitsSemaine > 1 ? 's' : ''} de nuit par semaine · {Math.round(ind.dimanches * 100)} % des dimanches travaillés (groupe de décalage 0).
          </Fine>
        )}
        {ind && <Controles msgs={ind.alertes.map(text => ({ text, bad: false }))} />}
        <Fine>
          Le code ne change plus. Les créneaux déjà générés ou publiés ne changent pas : seules les prochaines générations suivent la nouvelle séquence. Un cycle
          s’archive (il n’est plus proposé aux affectations) une fois ses affectations terminées.
        </Fine>
      </>}
    </Dialog>
  );
}

const SANS_EXIGENCE: Exigences = { formations: [], habilitations: [] };

export function RefBesoinDialog({ id, equipe }: { id?: number | null; equipe?: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const r = d.ds.referentiels;
  const [avant] = useState(() => (id != null ? (d.ds.besoinsPoste ?? []).find(b => b.id === id) ?? null : null));
  const [eq, setEq] = useState(avant?.equipe ?? equipe ?? r.equipes[0]?.nom ?? '');
  const [horaire, setHoraire] = useState(avant?.horaire ?? '');
  const [jours, setJours] = useState<number[]>(avant?.jours ?? [0, 1, 2, 3, 4]);
  const [effectif, setEffectif] = useState(String(avant?.effectifMin ?? 1));
  const [activite, setActivite] = useState(avant?.activite ?? '');
  const [exigences, setExigences] = useState<Exigences>(avant?.exigences ?? SANS_EXIGENCE);
  const [du, setDu] = useState(avant?.du ?? d.ti);
  const [au, setAu] = useState(avant?.au ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const disparu = id != null && !avant;
  const p = { equipe: eq, horaire, jours, effectifMin: Number(effectif), activite: activite.trim() || null, exigences, du, au: au || null };
  const { erreurs } = controlerBesoin(p, { equipes: r.equipes, horaires: horairesDe(r), postes: r.postes, formations: r.formations, habilitations: r.habilitations }, avant);
  const envoyer = async () => {
    if (busy || !v.verifier(erreurs.equipe, erreurs.horaire, erreurs.jours, erreurs.effectifMin, erreurs.exigences, erreurs.du, erreurs.au, disparu)) return;
    setBusy(true);
    const x = await run(avant ? 'planning.besoin.modifier' : 'planning.besoin.creer', avant ? { id: avant.id, ...p } : p);
    setBusy(false);
    if (x.ok) closeDialog();
  };
  return (
    <Dialog title={avant ? 'Besoin de poste' : 'Nouveau besoin de poste'} width={600} onSubmit={envoyer}
      actions={disparu ? <CancelButton label="Fermer" /> : <><CancelButton /><SubmitButton busy={busy}>{avant ? 'Enregistrer' : 'Ajouter'}</SubmitButton></>}>
      {disparu ? <Bloquant>Ce besoin n’existe plus.</Bloquant> : <>
        <div className="grid-2">
          <Field label="Équipe" htmlFor="bes-equipe" requis erreur={v.erreur(erreurs.equipe)}>
            <select className="input" id="bes-equipe" value={eq} onChange={e => setEq(e.target.value)}>
              {r.equipes.map(q => <option key={q.nom} value={q.nom}>{q.nom}</option>)}
            </select>
          </Field>
          <Field label="Horaire" htmlFor="bes-horaire" requis erreur={v.erreur(erreurs.horaire)}>
            <select className="input" id="bes-horaire" value={horaire} onChange={e => setHoraire(e.target.value)}>
              <option value="">Choisir…</option>
              {horairesEnVigueur(r).map(h => <option key={h.code} value={h.code}>{h.code} · {h.nom}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Jours de la semaine" requis erreur={v.erreur(erreurs.jours)}>
          <div className="chips" role="group" aria-label="Jours de la semaine" style={{ gap: 'var(--space-2) var(--space-4)' }}>
            {JOURS_BESOIN.map((j, i) => (
              <label key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={jours.includes(i)} onChange={e => setJours(e.target.checked ? [...jours, i].sort() : jours.filter(x => x !== i))} style={{ accentColor: 'var(--color-accent)' }} />
                {j}
              </label>
            ))}
          </div>
        </Field>
        <div className="grid-2">
          <Field label="Effectif minimal" htmlFor="bes-effectif" requis erreur={v.erreur(erreurs.effectifMin)}>
            <input className="input tnum" id="bes-effectif" inputMode="numeric" value={effectif} maxLength={2} onChange={e => setEffectif(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 120 }} />
          </Field>
          <Field label={<>Activité<span className="who"> · facultatif</span></>} htmlFor="bes-activite">
            <input className="input" id="bes-activite" value={activite} maxLength={60} placeholder="Conduite de ligne, cariste…" onChange={e => setActivite(e.target.value)} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="À partir du" htmlFor="bes-du" requis erreur={v.erreur(erreurs.du)}>
            <input className="input" id="bes-du" type="date" value={du} onChange={e => setDu(e.target.value)} />
          </Field>
          <Field label={<>Jusqu’au<span className="who"> · facultatif</span></>} htmlFor="bes-au" erreur={v.erreur(erreurs.au)}>
            <input className="input" id="bes-au" type="date" value={au} min={du || undefined} onChange={e => setAu(e.target.value)} />
          </Field>
        </div>
        <ExigencesChoix value={exigences} onChange={setExigences} avant={avant?.exigences ?? null} erreurs={{ formations: v.erreur(erreurs.exigences), habilitations: null }} />
        <Fine>
          Exigences propres au créneau, en plus de celles du poste et de l’équipe (exemple : un cariste CACES sur le poste de nuit) : elles sont contrôlées à la
          date de chaque créneau avant la publication. L’effectif minimal s’affiche sur la ligne de couverture du planning.
        </Fine>
      </>}
    </Dialog>
  );
}
