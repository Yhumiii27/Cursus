// Paramètres → Badgeage, géolocalisation au pointage (lot 12, chantier C6, étape 3) : zone de pointage d'un site ou d'un
// chantier, centre en degrés décimaux (WGS 84, tels que les donne une carte en ligne) et rayon en mètres. Contrôles
// partagés avec le serveur (shared/rules/geolocalisation.ts, action `pointage.zone.enregistrer`, administrateur RH). Aucune
// position de salarié n'est saisie ni montrée ici.
import { useState } from 'react';
import { LIBELLE_ZONE_MAX, lireZone, RAYON_MAX_M, RAYON_MIN_M } from '../../../shared/rules/geolocalisation.ts';
import type { ZonePointage } from '../../../shared/types.ts';
import { CancelButton, Dialog, Field, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Fine } from '../components/ui.tsx';
import { useData, useStore } from '../state/store.tsx';

/** Nombre saisi avec une virgule ou un point (« 48,5734 »). */
const nombre = (t: string) => (t.trim() === '' ? '' : Number(t.trim().replace(',', '.')));

export function ZonePointageDialog({ zone }: { zone?: ZonePointage }) {
  const data = useData();
  const { run, closeDialog } = useStore();
  const [libelle, setLibelle] = useState(zone?.libelle ?? '');
  const [siteCode, setSiteCode] = useState(zone?.siteCode ?? '');
  const [chantierId, setChantierId] = useState(zone?.chantierId ?? '');
  const [lat, setLat] = useState(zone ? String(zone.lat).replace('.', ',') : '');
  const [lng, setLng] = useState(zone ? String(zone.lng).replace('.', ',') : '');
  const [rayon, setRayon] = useState(zone ? String(zone.rayonM) : '200');
  const [actif, setActif] = useState(zone?.actif ?? true);
  const [busy, setBusy] = useState(false);
  const v = useVerification();

  const saisie = { libelle, siteCode, chantierId, lat: nombre(lat), lng: nombre(lng), rayonM: nombre(rayon), actif };
  // Un message par champ : la règle partagée rend la première erreur, chaque champ est contrôlé seul.
  const seul = (x: Partial<typeof saisie>) => {
    const r = lireZone({ libelle: 'Zone', lat: 0, lng: 0, rayonM: 100, ...x });
    return typeof r === 'string' ? r : null;
  };
  const erreurs = {
    libelle: seul({ libelle }), lat: seul({ lat: saisie.lat }), lng: seul({ lng: saisie.lng }), rayon: seul({ rayonM: saisie.rayonM }),
  };
  const sites = data.referentiels.sites ?? [], chantiers = data.referentiels.chantiers ?? [];

  const envoyer = async () => {
    if (busy || !v.verifier(erreurs.libelle, erreurs.lat, erreurs.lng, erreurs.rayon)) return;
    setBusy(true);
    const r = await run('pointage.zone.enregistrer', { ...(zone ? { id: zone.id } : {}), ...saisie });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  return (
    <Dialog title={zone ? `Zone de pointage · ${zone.libelle}` : 'Nouvelle zone de pointage'} width={560} onSubmit={envoyer} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Enregistrer</SubmitButton>
    </>}>
      <Field label="Libellé" htmlFor="zone-libelle" requis erreur={v.erreur(erreurs.libelle)}>
        <input className="input" id="zone-libelle" maxLength={LIBELLE_ZONE_MAX} placeholder="Chantier de …, site de …" value={libelle} onChange={e => setLibelle(e.target.value)} />
      </Field>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Site" htmlFor="zone-site">
          <select className="input" id="zone-site" value={siteCode} onChange={e => setSiteCode(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">Aucun</option>
            {sites.map(x => <option key={x.code} value={x.code}>{x.code} · {x.libelle}</option>)}
            {siteCode && !sites.some(x => x.code === siteCode) && <option value={siteCode}>{siteCode} (absent du référentiel)</option>}
          </select>
        </Field>
        <Field label="Chantier" htmlFor="zone-chantier">
          <select className="input" id="zone-chantier" value={chantierId} onChange={e => setChantierId(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">Aucun</option>
            {chantiers.map(x => <option key={x.id} value={x.id}>{x.id} · {x.nom}</option>)}
            {chantierId && !chantiers.some(x => x.id === chantierId) && <option value={chantierId}>{chantierId} (absent du référentiel)</option>}
          </select>
        </Field>
      </div>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Latitude du centre" htmlFor="zone-lat" requis erreur={v.erreur(erreurs.lat)}>
          <input className="input tnum" id="zone-lat" inputMode="decimal" placeholder="48,5734" value={lat} onChange={e => setLat(e.target.value)} style={{ maxWidth: 160 }} />
        </Field>
        <Field label="Longitude du centre" htmlFor="zone-lng" requis erreur={v.erreur(erreurs.lng)}>
          <input className="input tnum" id="zone-lng" inputMode="decimal" placeholder="7,7521" value={lng} onChange={e => setLng(e.target.value)} style={{ maxWidth: 160 }} />
        </Field>
        <Field label="Rayon (mètres)" htmlFor="zone-rayon" requis erreur={v.erreur(erreurs.rayon)}>
          <input className="input tnum" id="zone-rayon" inputMode="numeric" value={rayon} onChange={e => setRayon(e.target.value)} style={{ maxWidth: 120 }} />
        </Field>
      </div>
      <Fine>
        Degrés décimaux (WGS 84), tels que les donne une carte en ligne au clic droit sur le lieu ; rayon de {RAYON_MIN_M} à {RAYON_MAX_M.toLocaleString('fr-FR')} m,
        assez large pour couvrir le chantier et l’imprécision d’un téléphone (souvent 20 à 50 m en extérieur).
      </Fine>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={actif} onChange={e => setActif(e.target.checked)} style={{ accentColor: 'var(--color-accent)', flex: 'none' }} />
        <span>Zone active (une zone inactive n’est plus prise en compte ; les verdicts déjà gardés restent)</span>
      </label>
    </Dialog>
  );
}
