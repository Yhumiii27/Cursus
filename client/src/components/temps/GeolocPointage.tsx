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
      <strong>Géolocalisation au pointage</strong>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={v.geolocActive} disabled={!admin} onChange={e => { maj({ geolocActive: e.target.checked }); setTente(false); }}
          style={{ accentColor: 'var(--color-accent)', marginTop: 'var(--space-1)', flex: 'none' }} />
        <span>
          Vérifier la position au pointage des populations désignées ci-dessous
          <span className="text-muted sub" style={{ display: 'block' }}>
            Seulement pour des salariés qui n’ont aucun autre moyen de pointer sur place (équipes itinérantes de chantier) : position lue une fois, au clic sur
            « Pointer », jamais en continu ni hors ligne ; seul le verdict est gardé ; un refus n’empêche jamais de pointer.
          </span>
        </span>
      </label>
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        <Field label="Finalité" htmlFor="geo-finalite" requis={v.geolocActive} erreur={tente && erreurActivation && !v.geolocFinalite.trim() ? 'Écrivez la finalité.' : null}>
          <textarea className="input" id="geo-finalite" rows={2} maxLength={FINALITE_MAX} disabled={!admin} placeholder="Pourquoi ces salariés ne peuvent pas pointer autrement…"
            value={v.geolocFinalite} onChange={e => maj({ geolocFinalite: e.target.value })} style={{ minWidth: 260 }} />
        </Field>
        <Field label="AIPD validée par le DPO le" htmlFor="geo-aipd" requis={v.geolocActive} erreur={tente && erreurActivation && v.geolocFinalite.trim() && !v.geolocAipdLe ? 'Indiquez la date de l’analyse d’impact.' : null}>
          <input className="input" id="geo-aipd" type="date" value={v.geolocAipdLe ?? ''} disabled={!admin} onChange={e => maj({ geolocAipdLe: e.target.value || null })} style={{ maxWidth: 200 }} />
        </Field>
        <Field label="Précision exigée" htmlFor="geo-precision">
          <select className="input" id="geo-precision" value={v.geolocPrecisionM} disabled={!admin} onChange={e => maj({ geolocPrecisionM: Number(e.target.value) })} style={{ maxWidth: 160 }}>
            {[PRECISION_MIN_M, 50, 100, 200, 500, PRECISION_MAX_M].map(n => <option key={n} value={n}>{n} m</option>)}
          </select>
        </Field>
      </div>
      <Field label="Populations géolocalisées" htmlFor="geo-populations" erreur={tente ? erreurPopulations ?? (erreurActivation && !populations.length ? 'Désignez au moins une population.' : null) : null}>
        <div id="geo-populations" tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {!populations.length && <span className="text-muted sub">Aucune : la position n’est jamais demandée.</span>}
          {populations.map((p, i) => (
            <div key={i} className="row-wrap" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
              <select className="input" aria-label={`Population géolocalisée ${i + 1} : critère`} value={p.critere} disabled={!admin} onChange={e => majPopulation(i, { critere: e.target.value as CriterePopulation, valeur: '' })} style={{ maxWidth: 220 }}>
                {Object.entries(CRITERES_POPULATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className="input" aria-label={`Population géolocalisée ${i + 1} : valeur`} value={p.valeur} disabled={!admin} onChange={e => majPopulation(i, { valeur: e.target.value })} style={{ maxWidth: 220 }}>
                <option value="">Choisir…</option>
                {valeurs(p.critere).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                {p.valeur && !valeurs(p.critere).some(([k]) => k === p.valeur) && <option value={p.valeur}>{p.valeur} (absente du référentiel)</option>}
              </select>
              {admin && <CloseButton size={28} label={`Retirer la population géolocalisée ${i + 1}`} onClick={() => maj({ geolocPopulations: populations.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          {admin && populations.length < POPULATIONS_MAX && (
            <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => maj({ geolocPopulations: [...populations, { critere: 'equipe', valeur: '' }] })}>Ajouter une population</button></div>
          )}
        </div>
      </Field>
      <Fine>Une population géolocalisée doit aussi pointer (populations ci-dessus) : son mode et sa date d’effet sont ceux du badgeage. Forfait jours et cadres dirigeants ne sont jamais géolocalisés.</Fine>
      {admin && modifie && <div className="actions-end"><Btn variant="primary" disabled={busy} onClick={enregistrer}>Enregistrer la géolocalisation</Btn></div>}

      <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
        <strong className="sub">Zones de pointage{zones ? ` · ${actives} active${actives > 1 ? 's' : ''}` : ''}</strong>
        {admin && <Btn small variant="secondary" onClick={() => openDialog({ type: 'zonePointage' })}>Ajouter une zone</Btn>}
      </div>
      {!rh ? <Fine>Zones consultées par le service RH.</Fine>
        : erreur && !zones ? <Empty pad="sm">{erreur}</Empty>
        : !zones ? <Empty pad="sm">Chargement des zones…</Empty>
        : !zones.length ? <Empty pad="sm">Aucune zone : sans zone active, la position n’est pas demandée.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Zone</th><th>Site ou chantier</th><th className="right">Rayon</th><th>État</th><th></th></tr></thead>
              <tbody>
                {zones.map(z => (
                  <tr key={z.id}>
                    <td>{z.libelle}<div className="text-muted sub tnum">{z.lat.toLocaleString('fr-FR', { maximumFractionDigits: 6 })} ; {z.lng.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</div></td>
                    <td className="text-muted">{[z.siteCode, z.chantierId].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="right tnum">{z.rayonM.toLocaleString('fr-FR')} m</td>
                    <td>{z.actif ? <Tag cls="tag-accent">Active</Tag> : <Tag cls="tag-outline">Inactive</Tag>}</td>
                    <td className="right nowrap">
                      {admin && <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'zonePointage', zone: z })}>Modifier</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: suppressionZonePointage(z) })}>Supprimer</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {!s.geolocActive && <NoteAccent>Géolocalisation désactivée : aucune position n’est demandée. Avant l’activation : avis du CSE, analyse d’impact (AIPD) avec le DPO, finalité écrite et information des salariés concernés.</NoteAccent>}
      <Fine>
        Activée, la géolocalisation est admise par le navigateur sur toutes les pages de Cursus (en-tête Permissions-Policy), mais la position n’est demandée
        qu’aux populations désignées, au clic. Le changement vaut au rechargement de l’application (l’application installée garde sa page jusque-là).
      </Fine>
    </div>
  );
}
