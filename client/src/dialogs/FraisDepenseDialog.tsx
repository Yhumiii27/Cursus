// lot 11 — notes de frais : saisie d'une dépense (`frais.ligne.ajouter`, `frais.ligne.modifier`), téléphone d'abord.
// - Dans une note (`noteId`), ou dépense rapide sans note (brouillon ordinaire du mois de la dépense, créé au besoin par
//   le serveur : raccourci « Nouvelle dépense » de l'application installée, bouton de Mes frais).
// - Photo du reçu : appareil photo du téléphone (pwa/photo.ts : métadonnées retirées, position GPS comprise ; HEIC
//   converti en JPEG) ou fichier PDF, JPEG, PNG ; envoyée à l'enregistrement, puis jointe et scellée à la soumission.
// - « Coller le texte du reçu » : texte copié depuis la photo par l'outil du téléphone (Live Text, Google Lens), lu par
//   shared/rules/frais-lecture.ts ; ce ne sont que des propositions, à vérifier ; le texte n'est ni gardé ni envoyé.
// - Réseau coupé pendant l'envoi de la photo : la dépense et sa photo sont gardées chiffrées sur l'appareil et partent au
//   retour du réseau (pwa/pilote.ts) ; jamais des frais médicaux (shared/hors-ligne.ts).
import { useRef, useState } from 'react';
import { CameraIcon } from '@phosphor-icons/react';
import { CATEGORIES_FRAIS, lignesDe } from '../../../shared/rules/frais.ts';
import { lireRecu, TEXTE_RECU_MAX } from '../../../shared/rules/frais-lecture.ts';
import { FORFAITS_FRAIS, plafondInterne } from '../../../shared/rules/frais-politique.ts';
import { TYPES_VEHICULE, vehiculeAuJour } from '../../../shared/rules/frais-km.ts';
import { tauxPropose, TAUX_TVA } from '../../../shared/rules/frais-tva.ts';
import { depotOuvert, erreurPiece, tailleTexte } from '../../../shared/rules/pieces.ts';
import type { CategorieFrais, CodeForfaitFrais } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { CancelButton, Dialog, Field, Static, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Btn, Fine } from '../components/ui.tsx';
import { euros, justificatifs, nomNote } from '../components/frais/commun.ts';
import { CATEGORIES_RAPIDES, categoriesProposees, champsDepense, type ChampsDepense, demandeRecu, erreursDepense, payloadDepense, propositionsRecu } from '../components/frais/saisie.ts';
import { CHAMP_PHOTO, preparerPhoto } from '../pwa/photo.ts';
import { MESSAGE_GARDEE } from '../pwa/pilote.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

const ACCEPTE_FICHIER = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

export function FraisDepenseDialog({ noteId, id }: { noteId?: number | null; id?: number | null }) {
  const d = useDomain();
  const { me } = useRole();
  const { run, closeDialog, notify, session, horsLigne } = useStore();
  const ligne = id ? (d.ds.lignesFrais ?? []).find(l => l.id === id) ?? null : null;
  const note = (d.ds.notesFrais ?? []).find(n => n.id === (ligne?.noteId ?? noteId)) ?? null;
  const rapide = !note;
  const empId = note?.empId ?? me;
  const medicale = !!note?.medicale;
  const categories = rapide ? CATEGORIES_RAPIDES : categoriesProposees(medicale);
  const [c, setC] = useState<ChampsDepense>(() => champsDepense(d.ti, ligne?.categorie ?? categories[0], ligne));
  const [texte, setTexte] = useState('');
  const [lu, setLu] = useState<string | null>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [cle, setCle] = useState(0);
  const [busy, setBusy] = useState(false);
  const envoye = useRef<{ f: File; jeton: string } | null>(null);
  const v = useVerification();
  const piecesActives = depotOuvert(d.ds.settings.piecesStockage);
  const maj = (patch: Partial<ChampsDepense>) => setC(x => ({ ...x, ...patch }));
  // Taux de TVA proposé par la catégorie, sauf s'il a été changé à la main.
  const tauxTexte = (cat: CategorieFrais) => { const x = tauxPropose(cat); return x == null ? '' : String(x).replace('.', ','); };
  const choisirCategorie = (cat: CategorieFrais) => maj({ categorie: cat, tvaTaux: c.tvaTaux === tauxTexte(c.categorie) ? tauxTexte(cat) : c.tvaTaux });

  const e = erreursDepense(c, d.ti);
  const erreurFichier = fichier ? erreurPiece({ type: fichier.type, taille: fichier.size }) : null;
  const deja = ligne ? justificatifs(d.ds.pieces, ligne).length : 0;
  const vehicules = (d.ds.vehiculesPerso ?? []).filter(x => x.empId === empId && (!c.date || vehiculeAuJour(x, c.date)));
  const plafond = plafondInterne(d.ds.settings.fraisPlafonds, { categorie: c.categorie });
  const reel = demandeRecu(c.categorie);

  const lire = () => {
    const r = propositionsRecu(lireRecu(texte), c);
    setC(r.champs);
    const reconnus = r.reconnus.join(', ');
    setLu(reconnus ? `${t('Proposed from the text read: ')}${reconnus}${t('. Check each field.')}` : t('Nothing recognised in this text: enter the fields.'));
  };

  const envoyer = async () => {
    if (busy || !v.verifier(e.date ?? null, e.montant ?? null, e.devise ?? null, e.km ?? null, e.vehiculeId ?? null, e.forfait ?? null, e.invites ?? null, e.taux ?? null, erreurFichier)) return;
    setBusy(true);
    const payload: Record<string, unknown> = { ...payloadDepense(c), ...(ligne ? { id: ligne.id } : note ? { noteId: note.id } : { empId }) };
    if (!ligne && note) payload.empId = note.empId;
    let jetons: string[] = [];
    let pret: File | null = null;
    if (fichier && piecesActives) {
      try {
        pret = fichier.type.startsWith('image/') ? await preparerPhoto(fichier) : fichier;
        if (envoye.current?.f === fichier) jetons = [envoye.current.jeton];
        else {
          const p = await api.envoyerPiece(pret, session?.role);
          envoye.current = { f: fichier, jeton: p.jeton };
          jetons = [p.jeton];
        }
      } catch (err) {
        // Réseau absent : dépense et photo gardées sur l'appareil (nouvelle dépense, pas de frais médicaux).
        if ((err as { status?: number }).status === 0 && pret && !ligne && !medicale && horsLigne.disponible
          && await horsLigne.garderAvecPieces('frais.ligne.ajouter', payload, [{ nom: pret.name, type: pret.type, octets: new Uint8Array(await pret.arrayBuffer()) }])) {
          setBusy(false);
          notify(MESSAGE_GARDEE);
          closeDialog();
          return;
        }
        setBusy(false);
        notify(`${t('Photo of the receipt not sent — ')}${(err as Error).message}`, true);
        return;
      }
    }
    const r = await run(ligne ? 'frais.ligne.modifier' : 'frais.ligne.ajouter', { ...payload, ...(jetons.length ? { jetons } : {}) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  const titre = ligne ? t('Edit the expense') : rapide ? t('New expense') : t('Add an expense');
  return (
    <Dialog title={titre} width={560} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>{ligne ? t('Save') : t('Add the expense')}</SubmitButton>
    </>}>
      <Field label={t('Note')}><Static>{note ? `${nomNote(note)}${lignesDe(d.ds.lignesFrais, note.id).length ? '' : t(' · no expense yet')}` : t('Note of the month of the expense (created if needed)')}</Static></Field>
      {piecesActives && reel && (
        <div className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="btn btn-primary btn-sm" htmlFor="frais-photo"><CameraIcon size={16} aria-hidden="true" /> {t('Photograph the receipt')}</label>
            <input key={`p${cle}`} id="frais-photo" className="sr-only" {...CHAMP_PHOTO} onChange={ev => setFichier(ev.target.files?.[0] ?? null)} />
            <label className="btn btn-ghost btn-sm" htmlFor="frais-fichier">{t('Choose a file')}</label>
            <input key={`f${cle}`} id="frais-fichier" className="sr-only" type="file" accept={ACCEPTE_FICHIER} onChange={ev => setFichier(ev.target.files?.[0] ?? null)} />
            {fichier && <Btn small onClick={() => { setFichier(null); setCle(k => k + 1); }}>{t('Remove')}</Btn>}
          </div>
          <div className={erreurFichier ? 'field-erreur' : 'text-muted sub'} role={erreurFichier ? 'alert' : undefined}>
            {fichier ? `${fichier.name} · ${tailleTexte(fichier.size)}${erreurFichier ? ` — ${erreurFichier}` : ''}` : deja ? `${tn(deja, 'supporting document', 'supporting documents')}${deja > 1 ? t(' already attached#plural') : t(' already attached')}.` : t('Receipt as a photo, or PDF, JPEG, PNG of 10 MB at most. The GPS position of the photo is never sent.')}
          </div>
        </div>
      )}
      {reel && (
        <details>
          <summary className="sub">{t('Paste the text of the receipt')}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Fine>{t('On the phone, copy the text of the photo (Live Text on iPhone, Google Lens on Android) and paste it here: Cursus proposes the amount, the date, the VAT and the merchant. The text is neither kept nor sent.')}</Fine>
            <textarea className="input" id="frais-texte" aria-label={t('Text of the receipt')} rows={4} maxLength={TEXTE_RECU_MAX} value={texte} onChange={ev => setTexte(ev.target.value)} />
            <div><Btn small onClick={lire} disabled={!texte.trim()}>{t('Read the text')}</Btn></div>
            {lu && <div className="text-muted sub" role="status">{lu}</div>}
          </div>
        </details>
      )}
      <div className="grid-2">
        <Field label={t('Date')} htmlFor="frais-date" requis erreur={v.erreur(e.date ?? null) || (c.date ? e.date : null)}>
          <input className="input" id="frais-date" type="date" max={d.ti} value={c.date} onChange={ev => maj({ date: ev.target.value })} />
        </Field>
        <Field label={t('Category')} htmlFor="frais-categorie">
          <select className="input" id="frais-categorie" value={c.categorie} onChange={ev => choisirCategorie(ev.target.value as CategorieFrais)} disabled={categories.length < 2}>
            {categories.map(x => <option key={x} value={x}>{CATEGORIES_FRAIS[x].label}</option>)}
          </select>
        </Field>
      </div>
      {c.categorie === 'ik' ? <>
        <div className="grid-2">
          <Field label={t('Distance (km)')} htmlFor="frais-km" requis erreur={v.erreur(e.km ?? null) || (c.km ? e.km : null)}>
            <input className="input tnum" id="frais-km" inputMode="decimal" value={c.km} onChange={ev => maj({ km: ev.target.value })} />
          </Field>
          <Field label={t('Personal vehicle')} htmlFor="frais-vehicule" requis erreur={v.erreur(e.vehiculeId ?? null)}>
            <select className="input" id="frais-vehicule" value={c.vehiculeId} onChange={ev => maj({ vehiculeId: ev.target.value })}>
              <option value="">{t('Choose…')}</option>
              {vehicules.map(x => <option key={x.id} value={x.id}>{TYPES_VEHICULE[x.type]} · {x.cv} CV{x.electrique ? t(' · electric') : ''}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('Departure')} htmlFor="frais-depart"><input className="input" id="frais-depart" value={c.depart} maxLength={300} onChange={ev => maj({ depart: ev.target.value })} /></Field>
          <Field label={t('Arrival')} htmlFor="frais-arrivee"><input className="input" id="frais-arrivee" value={c.arrivee} maxLength={300} onChange={ev => maj({ arrivee: ev.target.value })} /></Field>
        </div>
        <Fine>{t('Amount calculated with the mileage scale of the year, from the total of your journeys. The home-work journey does not give the right to allowances.')}</Fine>
      </> : c.categorie === 'forfait' ? <>
        <div className="grid-2">
          <Field label={t('Flat rate')} htmlFor="frais-forfait" requis erreur={v.erreur(e.forfait ?? null)}>
            <select className="input" id="frais-forfait" value={c.forfait} onChange={ev => maj({ forfait: ev.target.value })}>
              <option value="">{t('Choose…')}</option>
              {(Object.keys(FORFAITS_FRAIS) as CodeForfaitFrais[]).map(k => <option key={k} value={k}>{FORFAITS_FRAIS[k]}</option>)}
            </select>
          </Field>
          {c.forfait === 'etranger' && (
            <Field label={t('Country')} htmlFor="frais-pays" requis>
              <select className="input" id="frais-pays" value={c.pays} onChange={ev => maj({ pays: ev.target.value })}>
                <option value="">{t('Choose…')}</option>
                {d.ds.referentiels.destinations.map(x => <option key={x.code} value={x.code}>{x.pays}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label={t('Amount (€), empty: the limit of the year')} htmlFor="frais-montant" erreur={e.montant ?? null}>
          <input className="input tnum" id="frais-montant" inputMode="decimal" value={c.montant} onChange={ev => maj({ montant: ev.target.value })} />
        </Field>
      </> : <>
        <div className="grid-2">
          <Field label={t('Amount paid')} htmlFor="frais-montant" requis erreur={v.erreur(e.montant ?? null) || (c.montant ? e.montant : null)}>
            <input className="input tnum" id="frais-montant" inputMode="decimal" value={c.montant} onChange={ev => maj({ montant: ev.target.value })} autoFocus={!ligne} />
          </Field>
          <Field label={t('Currency')} htmlFor="frais-devise" erreur={e.devise ?? null}>
            <input className="input" id="frais-devise" value={c.devise} maxLength={3} autoCapitalize="characters" onChange={ev => maj({ devise: ev.target.value.toUpperCase() })} />
          </Field>
        </div>
        {c.devise.trim().toUpperCase() !== 'EUR' && !e.devise && (
          <div className="grid-2">
            <Field label={t('Rate (€ for 1 unit), empty: rate of the month')} htmlFor="frais-taux" erreur={e.taux ?? null}>
              <input className="input tnum" id="frais-taux" inputMode="decimal" value={c.taux} onChange={ev => maj({ taux: ev.target.value })} />
            </Field>
            <Field label={t('Or amount debited in euros')} htmlFor="frais-debite">
              <input className="input tnum" id="frais-debite" inputMode="decimal" value={c.montantEur} onChange={ev => maj({ montantEur: ev.target.value })} />
            </Field>
          </div>
        )}
        {!medicale && (
          <div className="grid-2">
            <Field label={t('VAT rate')} htmlFor="frais-tva">
              <select className="input" id="frais-tva" value={c.tvaTaux} onChange={ev => maj({ tvaTaux: ev.target.value })}>
                <option value="">{t('Without VAT')}</option>
                {TAUX_TVA.map(x => <option key={x} value={String(x).replace('.', ',')}>{String(x).replace('.', ',')} %</option>)}
              </select>
            </Field>
            <Field label={t('VAT amount, empty: calculated')} htmlFor="frais-tva-montant">
              <input className="input tnum" id="frais-tva-montant" inputMode="decimal" value={c.tvaMontant} onChange={ev => maj({ tvaMontant: ev.target.value })} />
            </Field>
          </div>
        )}
        <Field label={t('Merchant')} htmlFor="frais-commercant">
          <input className="input" id="frais-commercant" value={c.commercant} maxLength={300} onChange={ev => maj({ commercant: ev.target.value })} />
        </Field>
        {c.categorie === 'repas_affaires' && (
          <Field label={t('Guests')} htmlFor="frais-invites" requis erreur={v.erreur(e.invites ?? null)}>
            <input className="input" id="frais-invites" value={c.invites} maxLength={300} onChange={ev => maj({ invites: ev.target.value })} placeholder={t('Name and company of each guest')} />
          </Field>
        )}
        {plafond !== null && (
          <Field label={`${t('Reason if the amount exceeds the cap of the policy (')}${euros(plafond)})`} htmlFor="frais-motif">
            <input className="input" id="frais-motif" value={c.motifDepassement} maxLength={300} onChange={ev => maj({ motifDepassement: ev.target.value })} />
          </Field>
        )}
      </>}
      {reel && (
        <label className="check-row" htmlFor="frais-attestation">
          <input id="frais-attestation" type="checkbox" checked={c.sansJustificatif} onChange={ev => maj({ sansJustificatif: ev.target.checked })} />
          <span>{t('I have no supporting document: I solemnly declare that I incurred this expense for my work')}</span>
        </label>
      )}
      <Fine>
        {medicale
          ? t('Medical expenses: the note does not go through your manager; it is checked directly by accounting or HR.')
          : t('The receipt is attached to the expense; it becomes final (sealed) when the note is submitted.')}
        {!piecesActives ? t(' Supporting documents deactivated: keep the paper receipt.') : ''}
      </Fine>
    </Dialog>
  );
}
