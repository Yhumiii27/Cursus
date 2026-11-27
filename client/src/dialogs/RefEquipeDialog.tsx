// Écran Référentiels, onglet Postes : formations et habilitations exigées de tous les membres d'une équipe, quel que soit
// leur poste (shared/rules/exigences.ts). Même proposition et même annonce que pour un poste (dialogs/RefPosteDialog.tsx).
// Case « travail de nuit ou en continu » : aucun salarié de moins de 18 ans dans une équipe cochée (shared/rules/mineurs.ts).
// Couverture minimale (SST, EPI incendie…) : aucun seuil par défaut, « 1 SST au minimum » proposé (shared/rules/couverture.ts).
// Horaire de poste par défaut (lot 6, shared/rules/horaires.ts) : proposé sur les feuilles de temps de ses membres.
import { useMemo, useState } from 'react';
import { present } from '../../../shared/rules/contrats.ts';
import { controlerExigences, effetExigences, effetTexte, exigencesEquipe, exigencesProposees, nombreExigences } from '../../../shared/rules/exigences.ts';
import { mineursDeLEquipe } from '../../../shared/rules/mineurs.ts';
import { controlerCouverture, COUVERTURE_LIGNES_MAX, COUVERTURE_PROPOSEE, couvertureEquipe, RECOMMANDATION_INRS } from '../../../shared/rules/couverture.ts';
import { actif } from '../../../shared/rules/referentiels.ts';
import { horaireDe, horairesEnVigueur, horaireTexte } from '../../../shared/rules/horaires.ts';
import type { Exigences } from '../../../shared/types.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { ExigencesChoix } from '../components/ExigencesChoix.tsx';
import { Btn, Fine, NoteAccent, Seg } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

export function RefEquipeDialog({ nom }: { nom: string }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const ref = d.ds.referentiels;
  const [equipe] = useState(() => ref.equipes.find(q => q.nom === nom) ?? null);
  const avant = equipe ? exigencesEquipe(equipe) : null;
  const [exigences, setExigences] = useState<Exigences>(() => avant ?? { formations: [], habilitations: [] });
  // Choix explicite : tant que le service RH n'a répondu ni oui ni non, la case reste à renseigner et n'est pas envoyée
  // (le serveur la laisse inchangée) ; enregistrer les seules exigences ne vaut pas déclaration « pas de travail de nuit ».
  const [nuit, setNuit] = useState<'nr' | 'oui' | 'non'>(() => (equipe?.nuit == null ? 'nr' : equipe.nuit ? 'oui' : 'non'));
  // Couverture minimale : lignes { formation, minimum } en cours de saisie (minimum gardé en texte pendant la frappe).
  const couvertureAvant = couvertureEquipe(equipe);
  const [couverture, setCouverture] = useState(() => couvertureAvant.map(l => ({ formation: l.formation, min: String(l.min) })));
  // Horaire par défaut : « » pour aucun ; un horaire archivé depuis reste affiché tant qu'il n'est pas changé.
  const [horaire, setHoraire] = useState(equipe?.horaire ?? '');
  const horaires = horairesEnVigueur(ref), horaireArchive = horaireDe(ref, equipe?.horaire);
  const [busy, setBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const v = useVerification();

  const { erreurs } = controlerExigences(exigences, ref, avant);
  const membres = useMemo(() => d.ds.employes.filter(e => e.equipe === nom && present(e, d.ti)), [d, nom]);
  const saisie = couverture.map(l => ({ formation: l.formation, min: l.min.trim() === '' ? NaN : Number(l.min) }));
  const couvertureChangee = JSON.stringify(saisie) !== JSON.stringify(couvertureAvant);
  // Couverture inchangée : pas envoyée, donc pas contrôlée (le serveur la laisse telle quelle) ; un seuil que l'effectif ne
  // permet plus d'atteindre ne bloque pas l'enregistrement des exigences, son alerte reste affichée.
  const errCouverture = couvertureChangee ? controlerCouverture(saisie, ref, membres.length, couvertureAvant).erreur : null;
  // Formations proposées : catalogue en vigueur, et celles déjà suivies archivées depuis (gardées, sans effet).
  const formationsCouverture = ref.formations.filter(f => actif(f) || couvertureAvant.some(l => l.formation === f.id));
  const sst = ref.formations.find(f => f.id === COUVERTURE_PROPOSEE.formation && actif(f));
  const ligne = (i: number, x: Partial<{ formation: string; min: string }>) => setCouverture(c => c.map((l, j) => (j === i ? { ...l, ...x } : l)));
  const mineurs = useMemo(() => mineursDeLEquipe(d.ds.employes, nom, d.ti), [d, nom]);
  const errNuit = nuit === 'oui' && mineurs.length
    ? `${t('The team has an employee under 18 (')}${mineurs.map(e => e.nom).join(', ')}${t('): they cannot work at night (art. L3163-2) — first assign them to another team.')}`
    : null;
  const proposees = useMemo(() => exigencesProposees(d.ds, membres), [d, membres]);
  const cle = JSON.stringify(exigences);
  const effet = useMemo(() => {
    const x = JSON.parse(cle) as Exigences;
    const valeur = x.formations.length || x.habilitations.length ? x : null;
    return effetExigences(d.ds, { equipes: ref.equipes.map(q => (q.nom === nom ? { ...q, exigences: valeur } : q)) });
  }, [d, ref.equipes, nom, cle]);
  const nouveaux = effet.nouveaux;
  const deja = (k: keyof Exigences, id: string) => exigences[k].includes(id);
  const aReprendre = [...proposees.formations.filter(f => !deja('formations', f)), ...proposees.habilitations.filter(h => !deja('habilitations', h))].length;

  const envoyer = async (force = false) => {
    if (busy || !v.verifier(erreurs.formations, erreurs.habilitations, errNuit, errCouverture, !equipe)) return;
    if (!force && nouveaux.length) { setConfirmer(true); return; }
    setBusy(true);
    const r = await run('referentiel.equipe.exigences', {
      nom, ...exigences, ...(nuit === 'nr' ? {} : { nuit: nuit === 'oui' }), ...(couvertureChangee ? { couverture: saisie } : {}),
      ...(horaire !== (equipe?.horaire ?? '') ? { horaire } : {}),
    });
    setBusy(false);
    if (r.ok) closeDialog();
    else setConfirmer(false);
  };

  return (
    <Dialog title={`${t('Team ')}${nom}${t(' — requirements and organisation')}`} width={620} onSubmit={() => envoyer()}
      confirmation={confirmer ? {
        texte: `${effetTexte(effet)}${t('. Save anyway?')}`,
        bouton: t('Save anyway'), occupe: busy, confirmer: () => envoyer(true), annuler: () => setConfirmer(false),
      } : null}
      actions={!equipe ? <CancelButton label={t('Close')} /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
      </>}>
      {!equipe ? <Bloquant>{t('This team no longer exists.')}</Bloquant> : <>
        <ExigencesChoix value={exigences} onChange={setExigences} avant={avant} erreurs={{ formations: v.erreur(erreurs.formations), habilitations: v.erreur(erreurs.habilitations) }} />
        {nombreExigences(proposees) > 0 && aReprendre > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Fine>
              {t('Held by ')}{membres.length > 1 ? `${t('the #les')}${membres.length}${t(' members')}` : t('its member')}{t(':#colon')}{' '}
              {[...proposees.formations.map(f => d.fm(f).court), ...proposees.habilitations.map(h => d.hm(h).nom)].join(', ')}.
            </Fine>
            <Btn small onClick={() => setExigences({ formations: [...new Set([...exigences.formations, ...proposees.formations])], habilitations: [...new Set([...exigences.habilitations, ...proposees.habilitations])] })}>
              {t('Take over these titles')}
            </Btn>
          </div>
        )}
        <Field label={t('Organisation of work')} erreur={v.erreur(errNuit)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 14 }}>{t('Night or continuous work')}</span>
            <Seg name="equipe-nuit" label={t('Night or continuous work')} value={nuit} onChange={setNuit} style={{ alignSelf: 'flex-start' }}
              options={[...(equipe.nuit == null ? [['nr', t('To fill in')] as ['nr', string]] : []), ['oui', t('Yes')], ['non', t('No')]]} />
            <span className="text-muted sub">
              {nuit === 'nr' ? t('As long as the answer is not given, the sheet of employees under 18 recalls the ban on night work. ')
                : ''}{t('A night or continuous team takes no employee under 18 (art. L3163-2).')}
            </span>
          </div>
        </Field>
        <Field label={t('Minimum coverage (first-aiders, fire team members)')} erreur={v.erreur(errCouverture)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {couverture.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <select className="input" aria-label={`${t('Training course of threshold ')}${i + 1}`} value={l.formation} onChange={e => ligne(i, { formation: e.target.value })} style={{ flex: '1 1 220px' }}>
                  <option value="">{t('Training course…')}</option>
                  {formationsCouverture.map(f => <option key={f.id} value={f.id}>{f.court}{actif(f) ? '' : t(' (archived)#fem')}</option>)}
                </select>
                <input className="input" type="number" min={1} max={Math.max(1, membres.length)} step={1} inputMode="numeric" aria-label={`${t('Minimum of threshold ')}${i + 1}`}
                  value={l.min} onChange={e => ligne(i, { min: e.target.value })} style={{ width: 96 }} />
                <span className="text-muted sub">{t('at least#minimum')}</span>
                <Btn small onClick={() => setCouverture(c => c.filter((_, j) => j !== i))}>{t('Remove')}</Btn>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {couverture.length === 0 && sst && <Btn small onClick={() => setCouverture([{ formation: sst.id, min: String(COUVERTURE_PROPOSEE.min) }])}>{t('Offer 1 ')}{sst.court}{t(' at least')}</Btn>}
              {couverture.length < COUVERTURE_LIGNES_MAX && <Btn small onClick={() => setCouverture(c => [...c, { formation: '', min: '1' }])}>{t('Add a threshold')}</Btn>}
            </div>
            <span className="text-muted sub">
              {couverture.length ? t('Every day, at least this number of present members, without a current absence, holding a valid certification; otherwise a dated alert. ')
                : t('No threshold: no coverage follow-up for this team. ')}{RECOMMANDATION_INRS}{t(' Successive shifts (2x8, 3x8, continuous): one team per shift.')}
            </span>
          </div>
        </Field>
        <Field label={t('Default shift schedule')} htmlFor="equipe-horaire">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <select className="input" id="equipe-horaire" value={horaire} onChange={e => setHoraire(e.target.value)} style={{ maxWidth: 360 }}>
              <option value="">{t('No schedule')}</option>
              {horaireArchive?.archive && <option value={horaireArchive.code}>{horaireTexte(horaireArchive)}{t(' (archived)#masc')}</option>}
              {horaires.map(h => <option key={h.code} value={h.code}>{horaireTexte(h)} — {h.nom}</option>)}
            </select>
            <span className="text-muted sub">
              {t('Offered every day hours are entered on the members’ timesheets, who can change it day by day (Reference data → Schedules). Optional: without a schedule, the timesheet is kept as before.')}
            </span>
          </div>
        </Field>
        <Fine>
          {tn(membres.length, 'member', 'members')}{t('. These requirements are added to those of each one’s job (a requirement common to both only counts once); without a requirement, the status of the members does not change.')}
        </Fine>
        {nouveaux.length > 0 && !confirmer && <NoteAccent>{effetTexte(effet)}.</NoteAccent>}
        {effet.resolus > 0 && <Fine>{tn(effet.resolus, 'employee no longer has a missing requirement', 'employees no longer have a missing requirement')}.</Fine>}
      </>}
    </Dialog>
  );
}
