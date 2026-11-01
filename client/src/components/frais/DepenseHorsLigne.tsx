// lot 11 — notes de frais : dépense rapide de la page « Hors ligne » (Cursus ouvert sans réseau). Réponse du propriétaire
// du 31 octobre 2026 : aucune donnée n'est gardée sur le téléphone ; cette saisie n'en demande aucune : photo du reçu,
// montant, date, catégorie. Elle entre dans la file chiffrée de l'appareil sous le dernier compte connecté avec les notes
// de frais activées (state/hors-ligne.ts, `porteurGarde`) et part au retour du réseau, dans le brouillon du mois de la
// dépense (créé au besoin). Jamais de frais médicaux (shared/hors-ligne.ts) ; appareil partagé : rien n'est gardé.
import { useEffect, useState, type FormEvent } from 'react';
import { CameraIcon } from '@phosphor-icons/react';
import { isoParis } from '../../../../shared/dates.ts';
import { CATEGORIES_FRAIS } from '../../../../shared/rules/frais.ts';
import { erreurPiece, tailleTexte } from '../../../../shared/rules/pieces.ts';
import type { CategorieFrais } from '../../../../shared/types.ts';
import { CHAMP_PHOTO, preparerPhoto } from '../../pwa/photo.ts';
import { fileAppareil } from '../../pwa/useHorsLigne.ts';
import type { PorteurFrais } from '../../state/hors-ligne.ts';
import { Field } from '../Dialog.tsx';
import { Btn, Fine, Panel } from '../ui.tsx';
import { CATEGORIES_RAPIDES, champsDepense, erreursDepense, payloadDepense } from './saisie.ts';

export function DepenseHorsLigne({ onGardee }: { onGardee: () => void }) {
  const [porteur, setPorteur] = useState<PorteurFrais | null>(null);
  const ti = isoParis(new Date());
  const [date, setDate] = useState(ti);
  const [montant, setMontant] = useState('');
  const [categorie, setCategorie] = useState<CategorieFrais>('repas');
  const [photo, setPhoto] = useState<File | null>(null);
  const [cle, setCle] = useState(0);
  const [tente, setTente] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fileAppareil()?.porteurGarde().then(setPorteur).catch(() => setPorteur(null)); }, []);
  if (!porteur) return null;

  const c = { ...champsDepense(ti, categorie), date, montant };
  const e = erreursDepense(c, ti);
  const errPhoto = !photo ? 'Photographiez le reçu.' : erreurPiece({ type: photo.type, taille: photo.size });
  const envoyer = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (e.date || e.montant || errPhoto) { setTente(true); return; }
    setBusy(true);
    try {
      const p = await preparerPhoto(photo!);
      await fileAppareil()!.ajouter(porteur, 'frais.ligne.ajouter', { ...payloadDepense(c), empId: porteur.empId },
        { pieces: [{ nom: p.name, type: p.type, octets: new Uint8Array(await p.arrayBuffer()) }], champPieces: 'jetons' });
      setMessage('Dépense gardée sur cet appareil : elle part au retour du réseau, dans la note du mois.');
      setMontant(''); setPhoto(null); setCle(k => k + 1); setTente(false);
      onGardee();
    } catch (err) {
      setMessage(`Dépense non gardée — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Nouvelle dépense">
      <form onSubmit={envoyer} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label className="btn btn-primary btn-sm" htmlFor="hl-photo"><CameraIcon size={16} aria-hidden="true" /> Photographier le reçu</label>
          <input key={cle} id="hl-photo" className="sr-only" {...CHAMP_PHOTO} onChange={ev => setPhoto(ev.target.files?.[0] ?? null)} />
          <div className={tente && errPhoto ? 'field-erreur' : 'text-muted sub'} role={tente && errPhoto ? 'alert' : undefined}>
            {photo ? `${photo.name} · ${tailleTexte(photo.size)}` : tente && errPhoto ? errPhoto : 'La position GPS de la photo n’est jamais envoyée.'}
          </div>
        </div>
        <div className="grid-2">
          <Field label="Montant (€)" htmlFor="hl-montant" requis erreur={tente && e.montant}>
            <input className="input tnum" id="hl-montant" inputMode="decimal" value={montant} onChange={ev => setMontant(ev.target.value)} />
          </Field>
          <Field label="Date" htmlFor="hl-date" requis erreur={tente && e.date}>
            <input className="input" id="hl-date" type="date" max={ti} value={date} onChange={ev => setDate(ev.target.value)} />
          </Field>
        </div>
        <Field label="Catégorie" htmlFor="hl-categorie">
          <select className="input" id="hl-categorie" value={categorie} onChange={ev => setCategorie(ev.target.value as CategorieFrais)}>
            {CATEGORIES_RAPIDES.map(x => <option key={x} value={x}>{CATEGORIES_FRAIS[x].label}</option>)}
          </select>
        </Field>
        <div><Btn type="submit" variant="primary" small disabled={busy}>Garder la dépense</Btn></div>
        {message && <div className="text-muted sub" role="status">{message}</div>}
        <Fine>Commerçant, TVA et rattachement se complètent ensuite dans Mes frais. Les frais médicaux ne se saisissent pas hors ligne.</Fine>
      </form>
    </Panel>
  );
}
