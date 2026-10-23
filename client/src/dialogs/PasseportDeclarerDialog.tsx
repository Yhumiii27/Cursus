// Écran Formations, Passeport de prévention (lot 7, t066 ; shared/rules/passeport-prevention.ts) : lignes exportées puis
// déclarées sur la plateforme, notées « déclarées » tel jour. Elles ne sont plus proposées à l'export ; une marque posée
// par erreur se retire ligne par ligne. Le jour se contrôle comme sur le serveur (ni à venir, ni avant la formation).
// Les lignes se choisissent une à une : seules celles du dernier export fait depuis l'écran (`exportees`, clés renvoyées
// par le serveur) sont cochées d'office. Une ligne saisie depuis l'export, ou refusée par la plateforme, reste ainsi à
// déclarer ; sans export connu (écran rechargé), rien n'est coché.
import { useState } from 'react';
import { fmtIso, plural } from '../../../shared/format.ts';
import { erreurDateDeclaration, lignesPasseport, MENTION_PASSEPORT, plageLigne } from '../../../shared/rules/passeport-prevention.ts';
import { Bloquant, CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine, Tag } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

export function PasseportDeclarerDialog({ du, au, exportees }: { du: string; au: string; exportees: string[] | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  // Lignes encore à déclarer de la période, figées à l'ouverture (une autre personne a pu en marquer entre-temps).
  const [lignes] = useState(() => lignesPasseport(d, { du, au }));
  const exporte = exportees ? new Set(exportees) : null;
  const [choisies, setChoisies] = useState<string[]>(() => (exporte ? lignes.filter(l => exporte.has(l.cle)).map(l => l.cle) : []));
  const [le, setLe] = useState(d.ti);
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const retenues = lignes.filter(l => choisies.includes(l.cle));
  const derniere = retenues.reduce((m, l) => (l.au > m ? l.au : m), '');
  const erreur = erreurDateDeclaration(le, d.ti) ?? (le && derniere && le < derniere ? `Une formation se termine le ${fmtIso(derniere)} : la déclaration ne peut pas la précéder.` : null);
  const erreurChoix = retenues.length ? null : 'Cochez les lignes acceptées par la plateforme.';
  const salaries = new Set(retenues.map(l => l.empId)).size;
  const horsExport = exporte ? lignes.filter(l => !exporte.has(l.cle)).length : 0;
  const cocher = (cle: string, oui: boolean) => setChoisies(c => (oui ? [...c, cle] : c.filter(x => x !== cle)));

  const envoyer = async () => {
    if (busy || !v.verifier(erreur, erreurChoix)) return;
    setBusy(true);
    const r = await run('passeport.declarer', { cles: retenues.map(l => l.cle), le });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title="Lignes déclarées au Passeport de prévention" width={640} onSubmit={envoyer}
      actions={!lignes.length ? <CancelButton label="Fermer" /> : <>
        <CancelButton />
        <SubmitButton busy={busy}>Marquer déclarées</SubmitButton>
      </>}>
      {!lignes.length ? <Bloquant>Plus aucune ligne n’est à déclarer du {fmtIso(du)} au {fmtIso(au)} : elles ont été marquées entre-temps.</Bloquant> : <>
        <p style={{ margin: 0 }}>
          {plural(retenues.length, 'ligne cochée', 'lignes cochées')} ({plural(salaries, 'salarié', 'salariés')}) sur
          {' '}{plural(lignes.length, 'ligne à déclarer', 'lignes à déclarer')} du {fmtIso(du)} au {fmtIso(au)} : les lignes cochées ne seront
          plus proposées à l’export.
        </p>
        {exporte
          ? horsExport > 0 && <Fine>{plural(horsExport, 'ligne absente', 'lignes absentes')} du dernier export (saisie depuis, ou intérimaire) : {horsExport > 1 ? 'non cochées' : 'non cochée'}, à exporter d’abord.</Fine>
          : <Fine>Aucun export depuis l’ouverture de l’écran : cochez les seules lignes du fichier accepté par la plateforme.</Fine>}
        <Field label="Lignes déclarées" requis erreur={v.erreur(erreurChoix)}>
          <div role="group" aria-label="Lignes déclarées" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxHeight: 260, overflowY: 'auto' }}>
            {lignes.map(l => {
              const nom = d.emp(l.empId)?.nom ?? '—';
              return (
                <label key={l.cle} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={choisies.includes(l.cle)} onChange={ev => cocher(l.cle, ev.target.checked)} style={{ accentColor: 'var(--color-accent)' }} />
                  <span>{nom} — {l.intitule} ({plageLigne(l)})</span>
                  {exporte && !exporte.has(l.cle) && <Tag cls="tag-outline">Absente de l’export</Tag>}
                </label>
              );
            })}
          </div>
        </Field>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Btn small onClick={() => setChoisies(lignes.map(l => l.cle))}>Tout cocher</Btn>
          <Btn small onClick={() => setChoisies([])}>Tout décocher</Btn>
        </div>
        <Field label="Déclarées sur la plateforme le" htmlFor="passeport-le" requis erreur={le ? erreur : v.erreur(erreur)}>
          <input className="input" id="passeport-le" type="date" value={le} max={d.ti} onChange={e => setLe(e.target.value)} style={{ maxWidth: 200 }} />
        </Field>
        <Fine>
          À marquer une fois l’import accepté par la plateforme. {MENTION_PASSEPORT} : vérifiez le fichier avant l’envoi. Une marque posée par
          erreur se retire ligne par ligne (« Déjà déclarées » dans l’écran Formations).
        </Fine>
      </>}
    </Dialog>
  );
}
