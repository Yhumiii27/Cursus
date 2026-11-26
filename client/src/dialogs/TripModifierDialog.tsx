// Modification d'un déplacement par le service RH (`voyage.modifier`) : dates, destination et motif, avec les contrôles
// de la création (conflits de dates contrôlés en direct, le déplacement lui-même exclu). Un déplacement venu de Keystone
// garde la destination et le motif de son chantier : seules ses dates changent, et Keystone en est prévenu.
// Coordonnées sur place (t068) : hébergement, contact local et inscription sur Ariane, propres à Cursus (Keystone compris,
// sans le prévenir) ; textes du service RH, jamais montrés au manager ni au voyageur dans Cursus.
import { useState } from 'react';
import { blocage, conflitsDates } from '../../../shared/rules/conflits.ts';
import { formalitesCaduques } from '../../../shared/rules/deplacements.ts';
import { actifs } from '../../../shared/rules/referentiels.ts';
import { COORDONNEES_MAX, texteCoordonnees } from '../../../shared/rules/vigilance.ts';
import { CancelButton, Controles, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { erreursPeriode, erreurTexte } from '../components/controles.ts';
import { Fine } from '../components/ui.tsx';
import { useDomain } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t } from '../i18n/langue.ts';

export function TripModifierDialog({ id }: { id: number }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const vo = d.ds.voyages.find(x => x.id === id);
  const [dest, setDest] = useState(vo?.dest ?? '');
  const [depart, setDepart] = useState(vo?.depart ?? '');
  const [retour, setRetour] = useState(vo?.retour ?? '');
  const [motif, setMotif] = useState(vo?.motif ?? '');
  const [hebergement, setHebergement] = useState(vo?.hebergement ?? '');
  const [contact, setContact] = useState(vo?.contactSurPlace ?? '');
  const [ariane, setAriane] = useState(vo?.arianeLe ?? '');
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const emp = vo ? d.emp(vo.empId) : undefined;
  if (!vo || !emp) return null;

  const keystone = vo.origine === 'keystone';
  // Destinations en vigueur, plus celle du déplacement si elle a été archivée depuis.
  const dests = [...actifs(d.ds.referentiels.destinations), ...d.ds.referentiels.destinations.filter(x => x.code === vo.dest && x.archive)];
  const destDef = d.destOf(dest);
  const dates = erreursPeriode(depart, retour, { du: t('Enter the departure date.'), au: t('Enter the return date.') });
  const motifErr = keystone ? null : erreurTexte(motif, t('Enter the reason for the trip.'));
  const destErr = destDef ? null : t('Choose the destination.');
  const conflits = !dates.du && !dates.au ? conflitsDates(d, emp.id, depart, retour, 'voyage', { voyageId: vo.id }) : [];
  const coordErr = (x: string, label: string) => { const r = texteCoordonnees(x, label); return 'erreur' in r ? r.erreur : null; };
  const hebErr = coordErr(hebergement, t('Accommodation')), contactErr = coordErr(contact, t('Contact on site'));
  const arianeErr = ariane && ariane > d.ti ? t('Today at the latest.') : null;
  const coordChange = hebergement.trim() !== (vo.hebergement ?? '') || contact.trim() !== (vo.contactSurPlace ?? '') || ariane !== (vo.arianeLe ?? '');
  const inchange = dest === vo.dest && depart === vo.depart && retour === vo.retour && motif.trim() === vo.motif && !coordChange;
  // Formalités de détachement que la modification rend caduques (autre pays, période élargie, autre durée).
  const caduques = !dates.du && !dates.au ? formalitesCaduques(vo, { dest, depart, retour }) : {};
  const aRefaire = [
    'detachementLe' in caduques ? t('the social security certificate') : '',
    'informationLe' in caduques ? t('the written information of the assignment') : '',
  ].filter(Boolean);

  const confirm = async () => {
    if (busy || !v.verifier(destErr, dates.du, dates.au, motifErr, blocage(conflits), hebErr, contactErr, arianeErr)) return;
    // Rien de changé : rien à enregistrer.
    if (inchange) { closeDialog(); return; }
    setBusy(true);
    const coord = coordChange ? { hebergement, contactSurPlace: contact, arianeLe: ariane } : {};
    const r = await run('voyage.modifier', keystone ? { id, depart, retour, ...coord } : { id, dest, depart, retour, motif, ...coord });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={t('Edit the trip')} width={560} onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{t('Save')}</SubmitButton>
    </>}>
      <div className="grid-2">
        <Field label={t('Employee')}><Static>{emp.nom} · {emp.poste}</Static></Field>
        {keystone
          ? <Field label={t('Destination')}><Static>{destDef?.pays ?? vo.dest}</Static></Field>
          : (
            <Field label={t('Destination')} htmlFor="tm-dest" erreur={v.erreur(destErr)}>
              <select className="input" id="tm-dest" value={dest} onChange={e => setDest(e.target.value)}>
                {dests.map(o => <option key={o.code} value={o.code}>{o.pays}{o.archive ? t(' (archived)#fem') : ''}</option>)}
              </select>
            </Field>
          )}
      </div>
      <div className="grid-2">
        <Field label={t('Departure')} htmlFor="tm-dep" requis erreur={v.erreur(dates.du)}><input className="input" id="tm-dep" type="date" value={depart} onChange={e => setDepart(e.target.value)} /></Field>
        <Field label={t('Return#trip')} htmlFor="tm-ret" requis erreur={retour && dates.au && !dates.du ? dates.au : v.erreur(dates.au)}>
          <input className="input" id="tm-ret" type="date" min={depart || undefined} value={retour} onChange={e => setRetour(e.target.value)} />
        </Field>
      </div>
      <Controles msgs={conflits} />
      {aRefaire.length > 0 && <Fine>{t('Posting formalities to redo after this change: ')}{aRefaire.join(t(' and #et'))}{t('. The file becomes incomplete again.')}</Fine>}
      {keystone
        ? <Field label={t('Reason')}><Static>{vo.motif}</Static></Field>
        : <Field label={t('Reason')} htmlFor="tm-motif" requis erreur={v.erreur(motifErr)}><input className="input" id="tm-motif" type="text" value={motif} onChange={e => setMotif(e.target.value)} /></Field>}
      <Field label={t('Accommodation')} htmlFor="tm-heb" erreur={hebErr}>
        <input className="input" id="tm-heb" type="text" maxLength={COORDONNEES_MAX} value={hebergement} placeholder={t('Hotel, address, phone')} onChange={e => setHebergement(e.target.value)} />
      </Field>
      <div className="grid-2">
        <Field label={t('Contact on site')} htmlFor="tm-contact" erreur={contactErr}>
          <input className="input" id="tm-contact" type="text" maxLength={COORDONNEES_MAX} value={contact} placeholder={t('Name, phone')} onChange={e => setContact(e.target.value)} />
        </Field>
        <Field label={t('Registered on Ariane on')} htmlFor="tm-ariane" erreur={arianeErr}>
          <input className="input" id="tm-ariane" type="date" max={d.ti} value={ariane} onChange={e => setAriane(e.target.value)} />
        </Field>
      </div>
      {keystone && <Fine>{t('Trip from Keystone (worksite ')}{vo.chantier}{t('): destination and reason are those of the worksite. Keystone is told of the new dates.')}</Fine>}
      <p className="text-muted fine">{destDef ? d.destSummary(destDef) : ''}</p>
    </Dialog>
  );
}
