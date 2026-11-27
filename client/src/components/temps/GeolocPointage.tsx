// Paramètres → Badgeage (pages/parametres/Badgeage.tsx), géolocalisation au pointage (lot 12, chantier C6, étape 3 ; shared/rules/geolocalisation.ts).
// Option livrée désactivée, sous le badgeage : activation refusée sans le badgeage actif, la finalité écrite, la date de
// l'analyse d'impact (AIPD) validée par le DPO et au moins une population (COHERENCE de shared/reglages.ts). Populations :
// équipes itinérantes qui n'ont aucun autre moyen de pointer sur place (Cass. soc. 3 nov. 2011 ; CE 15 déc. 2017) ;
// précision exigée de la position ; zones de pointage (sites, chantiers), lues à la demande (GET /api/pointages/zones,
// hors de l'instantané) et tenues par l'administrateur RH. Réglages de l'administrateur RH, consultés par le service RH.
import { useEffect, useState } from 'react';
import { FINALITE_MAX, lirePopulationsGeoloc, PRECISION_MAX_M, PRECISION_MIN_M, refusActivationGeoloc } from '../../../../shared/rules/geolocalisation.ts';
import { CRITERES_POPULATION, POPULATIONS_MAX } from '../../../../shared/rules/pointage.ts';
import type { CriterePopulation, PopulationGeoloc, Settings, ZonePointage } from '../../../../shared/types.ts';
import { TEMPS_TRAVAIL } from '../../../../shared/constants.ts';
import { api } from '../../api.ts';
import { Field } from '../Dialog.tsx';
import { Btn, CloseButton, Empty, Fine, NoteAccent, Tag } from '../ui.tsx';
import { suppressionZonePointage } from '../../state/confirmations-pointage.ts';
import { useRole } from '../../state/derived.ts';
import { useData, useStore } from '../../state/store.tsx';
import { useEnregistrerReglages } from '../../pages/parametres/commun.ts';
import { t, tn } from '../../i18n/langue.ts';

const REGIMES = (['35h', '39h_rtt', 'forfait_heures_hebdo', 'forfait_heures_annuel', 'partiel'] as const).map(r => [r, TEMPS_TRAVAIL[r].label] as const);
const CHAMPS = ['geolocActive', 'geolocFinalite', 'geolocAipdLe', 'geolocPopulations', 'geolocPrecisionM'] as const;
type Champs = Pick<Settings, typeof CHAMPS[number]>;
const depuis = (s: Settings): Champs => Object.fromEntries(CHAMPS.map(k => [k, s[k]])) as Champs;

/** Zones lues à la demande (service RH), relues quand l'instantané change (zone ajoutée, modifiée, supprimée). */
function useZones(actif: boolean) {
  const data = useData();
  const [r, setR] = useState<{ zones: ZonePointage[] | null; erreur: string | null }>({ zones: null, erreur: null });
  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    api.zonesPointage().then(x => { if (vivant) setR({ zones: x.zones, erreur: null }); }, (e: Error) => { if (vivant) setR(o => ({ ...o, erreur: e.message })); });
    return () => { vivant = false; };
  }, [actif, data]);
  return r;
}

export function GeolocPointage({ s }: { s: Settings }) {
  const { admin, rh } = useRole();
  const data = useData();
  const { openDialog } = useStore();
  const save = useEnregistrerReglages();
  const [v, setV] = useState<Champs>(() => depuis(s));
  const [busy, setBusy] = useState(false);
  const [tente, setTente] = useState(false);
  // oxlint-disable-next-line react/exhaustive-deps -- relu quand l'un des réglages enregistrés change, pas à chaque rendu.
  useEffect(() => { setV(depuis(s)); setTente(false); }, CHAMPS.map(k => JSON.stringify(s[k])));
  const { zones, erreur } = useZones(rh);

  const maj = (x: Partial<Champs>) => setV(o => ({ ...o, ...x }));
  const populations = v.geolocPopulations ?? [];
  const majPopulation = (i: number, x: Partial<PopulationGeoloc>) => maj({ geolocPopulations: populations.map((p, j) => (j === i ? { ...p, ...x } : p)) });
  const valeurs = (c: CriterePopulation): readonly (readonly [string, string])[] => c === 'equipe' ? data.referentiels.equipes.map(q => [q.nom, q.nom] as const)
    : c === 'entite' ? (data.referentiels.entites ?? []).map(x => [x.code, `${x.code} · ${x.nom}`] as const)
    : c === 'site' ? (data.referentiels.sites ?? []).map(x => [x.code, `${x.code} · ${x.libelle}`] as const) : REGIMES;
  const lues = lirePopulationsGeoloc(populations);
  const erreurPopulations = typeof lues === 'string' ? lues : null;
  const erreurActivation = refusActivationGeoloc({ ...v, geolocFinalite: v.geolocFinalite.trim(), pointageActif: s.pointageActif });
  const modifie = CHAMPS.some(k => JSON.stringify(v[k]) !== JSON.stringify(s[k]));
  const enregistrer = async () => {
    if (erreurPopulations || erreurActivation) { setTente(true); document.getElementById(erreurPopulations ? 'geo-populations' : !v.geolocFinalite.trim() ? 'geo-finalite' : 'geo-aipd')?.focus(); return; }
    setBusy(true);
    await save({ ...v, geolocFinalite: v.geolocFinalite.trim() } satisfies Partial<Settings>);
    setBusy(false);
  };
  const actives = zones?.filter(z => z.actif).length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <strong>{t('Geolocation at clock-in')}</strong>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.geolocActive} disabled={!admin} onChange={e => { maj({ geolocActive: e.target.checked }); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          {t('Check the position at clock-in of the populations designated below')}
          <span className="text-muted sub" style={{ display: 'block' }}>
            {t('Only for employees who have no other means of clocking in on site (itinerant worksite teams): position read once, on clicking “Clock in”, never continuously nor offline; only the verdict is kept; a refusal never prevents clocking in.')}
          </span>
        </span>
      </label>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label={t('Purpose#finalite')} htmlFor="geo-finalite" requis={v.geolocActive} erreur={tente && erreurActivation && !v.geolocFinalite.trim() ? t('Write the purpose.') : null}>
          <textarea className="input" id="geo-finalite" rows={2} maxLength={FINALITE_MAX} disabled={!admin} placeholder={t('Why these employees cannot clock in otherwise…')}
            value={v.geolocFinalite} onChange={e => maj({ geolocFinalite: e.target.value })} style={{ minWidth: 260 }} />
        </Field>
        <Field label={t('DPIA approved by the DPO on')} htmlFor="geo-aipd" requis={v.geolocActive} erreur={tente && erreurActivation && v.geolocFinalite.trim() && !v.geolocAipdLe ? t('Enter the date of the impact assessment.') : null}>
          <input className="input" id="geo-aipd" type="date" value={v.geolocAipdLe ?? ''} disabled={!admin} onChange={e => maj({ geolocAipdLe: e.target.value || null })} style={{ maxWidth: 200 }} />
        </Field>
        <Field label={t('Precision required')} htmlFor="geo-precision">
          <select className="input" id="geo-precision" value={v.geolocPrecisionM} disabled={!admin} onChange={e => maj({ geolocPrecisionM: Number(e.target.value) })} style={{ maxWidth: 160 }}>
            {[PRECISION_MIN_M, 50, 100, 200, 500, PRECISION_MAX_M].map(n => <option key={n} value={n}>{n}{t(' m#metres')}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('Geolocated populations')} htmlFor="geo-populations" erreur={tente ? erreurPopulations ?? (erreurActivation && !populations.length ? t('Designate at least one population.') : null) : null}>
        <div id="geo-populations" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {!populations.length && <span className="text-muted sub">{t('None: the position is never requested.')}</span>}
          {populations.map((p, i) => (
            <div key={i} className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
              <select className="input" aria-label={`${t('Geolocated population ')}${i + 1}${t(': criterion')}`} value={p.critere} disabled={!admin} onChange={e => majPopulation(i, { critere: e.target.value as CriterePopulation, valeur: '' })} style={{ maxWidth: 220 }}>
                {Object.entries(CRITERES_POPULATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className="input" aria-label={`${t('Geolocated population ')}${i + 1}${t(': value')}`} value={p.valeur} disabled={!admin} onChange={e => majPopulation(i, { valeur: e.target.value })} style={{ maxWidth: 220 }}>
                <option value="">{t('Choose…')}</option>
                {valeurs(p.critere).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                {p.valeur && !valeurs(p.critere).some(([k]) => k === p.valeur) && <option value={p.valeur}>{p.valeur}{t(' (missing from the reference data)')}</option>}
              </select>
              {admin && <CloseButton size={28} label={`${t('Remove geolocated population ')}${i + 1}`} onClick={() => maj({ geolocPopulations: populations.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          {admin && populations.length < POPULATIONS_MAX && (
            <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => maj({ geolocPopulations: [...populations, { critere: 'equipe', valeur: '' }] })}>{t('Add a population')}</button></div>
          )}
        </div>
      </Field>
      <Fine>{t('A geolocated population must also clock in (populations above): its mode and its effective date are those of the badge clocking. Fixed-days and executive staff are never geolocated.')}</Fine>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>{t('Save the geolocation')}</Btn></div>}

      <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
        <strong className="sub">{t('Clock-in zones')}{zones ? ` · ${tn(actives, 'active#zone', 'active#zones')}` : ''}</strong>
        {admin && <Btn small variant="secondary" onClick={() => openDialog({ type: 'zonePointage' })}>{t('Add a zone')}</Btn>}
      </div>
      {!rh ? <Fine>{t('Zones consulted by HR.')}</Fine>
        : erreur && !zones ? <Empty pad="sm">{erreur}</Empty>
        : !zones ? <Empty pad="sm">{t('Loading the zones…')}</Empty>
        : !zones.length ? <Empty pad="sm">{t('No zone: without an active zone, the position is not requested.')}</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>{t('Zone')}</th><th>{t('Site or worksite')}</th><th className="right">{t('Radius')}</th><th>{t('State')}</th><th></th></tr></thead>
              <tbody>
                {zones.map(z => (
                  <tr key={z.id}>
                    <td>{z.libelle}<div className="text-muted sub tnum">{z.lat.toLocaleString('fr-FR', { maximumFractionDigits: 6 })} ; {z.lng.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</div></td>
                    <td className="text-muted">{[z.siteCode, z.chantierId].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="right tnum">{z.rayonM.toLocaleString('fr-FR')}{t(' m#metres')}</td>
                    <td>{z.actif ? <Tag cls="tag-accent">{t('Active#fem')}</Tag> : <Tag cls="tag-outline">{t('Inactive#fem')}</Tag>}</td>
                    <td className="right nowrap">
                      {admin && <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'zonePointage', zone: z })}>{t('Edit')}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: suppressionZonePointage(z) })}>{t('Delete')}</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {!s.geolocActive && <NoteAccent>{t('Geolocation deactivated: no position is requested. Before activation: CSE’s opinion, impact assessment (DPIA) with the DPO, written purpose and informing the employees concerned.')}</NoteAccent>}
      <Fine>
        {t('Activated, the geolocation is allowed by the browser on all Cursus pages (Permissions-Policy header), but the position is only requested from the designated populations, on click. The change applies when the application is reloaded (the installed application keeps its page until then).')}
      </Fine>
    </div>
  );
}
