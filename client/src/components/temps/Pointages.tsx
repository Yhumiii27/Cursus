// Badgeage virtuel (lot 12, chantier C6, étape 2) : contenu de l'onglet « Pointages » de Temps de travail
// (pages/Temps.tsx) et de l'écran Pointages (pages/Pointages.tsx).
// - Semaine d'un salarié (`PointagesSemaine`) : postes du jour de rattachement, pauses, pointé, théorique et solde,
//   anomalies à justifier (calculées par le serveur, jamais la nature d'une absence), pointages bruts avec leur origine,
//   « Signaler un oubli » et « Retirer » (demande de correction, ou saisie validée d'emblée par le valideur), demandes du
//   salarié. Mode « calcule » : rappel de la ligne PTG et « Reprendre le pointé sur la feuille ».
// - Présences du jour (`PresencesDuJour`, manager et service RH) : présent, parti, non pointé, absent, sans la nature
//   d'une absence ni d'historique heure par heure ; c'est un outil d'organisation, pas une surveillance.
// - Corrections à valider (`CorrectionsAValider`) : file du valideur (manager direct, suppléant « feuilles », service
//   RH), jamais ses propres demandes ; refus avec motif (state/confirmations-pointage.ts).
// Pointages, présences et anomalies sont lus à la demande (GET /api/pointages, /etat) ; seules les demandes de correction
// sont dans l'instantané (server/src/vues-pointage.ts).
import { useEffect, useState } from 'react';
import { addD, joursSemaine, parse } from '../../../../shared/dates.ts';
import { equipeLabel, fmtIso, fmtShort, plural } from '../../../../shared/format.ts';
import { ANOMALIES_POINTAGE, hhmmParis } from '../../../../shared/rules/pointage.ts';
import { feuilleCalculee } from '../../../../shared/rules/pointage-feuille.ts';
import type { Employe, ISODate } from '../../../../shared/types.ts';
import { api, type LecturePointages, type PresencesPointages } from '../../api.ts';
import { useAgir } from '../../state/actions.ts';
import { refusCorrectionPointage, retraitCorrectionPointage } from '../../state/confirmations-pointage.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Empty, Fine, NoteAccent, Panel, stop, Tag, Two } from '../ui.tsx';
import { Ouvrir } from '../Cliquable.tsx';
import { correctionsAValider, fMinutes, fSolde, modeDe, motifCorrection, objetCorrection, PRESENCES, STATUTS_CORRECTION, valideurPointages } from './pointage-etat.ts';

/** Lecture à la demande, relue quand l'instantané change (une correction validée ajoute un pointage). */
function useLecture<T>(lire: () => Promise<T>, cles: readonly unknown[]) {
  const [r, setR] = useState<{ v: T | null; erreur: string | null }>({ v: null, erreur: null });
  useEffect(() => {
    let vivant = true;
    lire().then(v => { if (vivant) setR({ v, erreur: null }); }, (e: Error) => { if (vivant) setR(x => ({ v: x.v, erreur: e.message })); });
    return () => { vivant = false; };
    // oxlint-disable-next-line react/exhaustive-deps -- `lire` change à chaque rendu : la relecture suit les seules `cles`.
  }, cles);
  return r;
}

const jourCourt = (j: ISODate) => parse(j).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

/** Semaine de pointages d'un salarié (lundi `wk`). */
export function PointagesSemaine({ emp, wk }: { emp: Employe; wk: ISODate }) {
  const d = useDomain();
  const data = d.ds;
  const { rh, manager, me, soi } = useRole();
  const { openDialog, run } = useStore();
  const { occupe, agir } = useAgir();
  const au = addD(wk, 6);
  const { v: l, erreur } = useLecture<LecturePointages>(() => api.pointages(emp.id, wk, au), [emp.id, wk, data]);
  const soiMeme = emp.id === me;
  const valideur = valideurPointages(d, emp.id, { rh, manager, me, soi });
  const peutCorriger = !!data.settings.pointageActif && (soiMeme || valideur);
  const mode = modeDe(data, emp.id, au < data.today ? au : data.today);
  const sh = data.feuilles.find(f => f.empId === emp.id && f.week === wk) ?? null;
  const corrections = (data.correctionsPointage ?? []).filter(c => c.empId === emp.id && c.jour >= wk && c.jour <= au).sort((a, b) => b.demandeLe.localeCompare(a.demandeLe));

  const signaler = () => openDialog({ type: 'correctionPointage', empId: emp.id, nature: 'ajout', jour: au < data.today ? au : data.today });
  const actions = peutCorriger && <Btn small variant="secondary" onClick={signaler}>{soiMeme ? 'Signaler un oubli' : 'Ajouter un pointage'}</Btn>;

  if (erreur && !l) return <Panel title="Pointages de la semaine"><Empty>{erreur}</Empty></Panel>;
  if (!l) return <Panel title="Pointages de la semaine"><Empty>Chargement des pointages…</Empty></Panel>;

  const jours = joursSemaine(wk);
  const postes = (j: ISODate) => l.postes.filter(p => p.jour === j);
  const parJour = (j: ISODate) => l.pointages.filter(p => p.jour === j).sort((a, b) => a.horodatage.localeCompare(b.horodatage));
  const neutralises = new Set(l.pointages.flatMap(p => (p.annuleId != null ? [p.annuleId] : [])));
  const enAttente = new Set(corrections.filter(c => c.statut === 'demandee' && c.pointageId != null).map(c => c.pointageId));
  const total = l.jours.reduce((n, j) => n + j.realise, 0), theo = l.jours.reduce((n, j) => n + j.theorique, 0);

  return (
    <>
      <Panel title={`Pointages de la semaine${soiMeme ? '' : ` · ${emp.nom}`}`} aside={actions || undefined}>
        {mode === 'declaratif' && !l.pointages.length && <Fine>{soiMeme ? 'Vous ne pointez pas' : `${emp.nom} ne pointe pas`} : le temps se déclare sur la feuille de temps.</Fine>}
        {feuilleCalculee(sh) && (
          <NoteAccent>
            Mode calculé : la ligne « PTG » de la feuille reprend le pointé de chaque jour, à répartir sur les projets.
            {sh && (sh.statut === 'brouillon' || sh.statut === 'rejetee') && (soiMeme || valideur) && <>
              {' '}<button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => run('pointage.reprendreFeuille', { empId: emp.id, week: wk }))}>Reprendre le pointé sur la feuille</button>
            </>}
          </NoteAccent>
        )}
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Jour</th><th>Postes</th><th>Pauses</th><th className="right">Pointé</th><th className="right">Prévu</th><th className="right">Solde</th></tr></thead>
            <tbody>
              {jours.map(j => {
                const x = l.jours.find(y => y.jour === j), ps = postes(j);
                return (
                  <tr key={j}>
                    <td className="nowrap">{jourCourt(j)}</td>
                    <td>{ps.length ? ps.map(p => `${hhmmParis(p.debut)} – ${p.enCours ? 'en cours' : hhmmParis(p.fin)}`).join(', ') : <span className="text-muted">—</span>}</td>
                    <td className="text-muted">{ps.flatMap(p => p.pauses).map(m => fMinutes(m)).join(', ') || '—'}</td>
                    <td className="right tnum">{x?.realise ? fMinutes(x.realise) : '—'}</td>
                    <td className="right tnum text-muted">{x?.theorique ? fMinutes(x.theorique) : '—'}</td>
                    <td className="right tnum">{x && (x.realise || x.theorique) ? fSolde(x.realise - x.theorique) : ''}</td>
                  </tr>
                );
              })}
              <tr><td><strong>Semaine</strong></td><td /><td /><td className="right tnum"><strong>{fMinutes(total)}</strong></td><td className="right tnum text-muted">{fMinutes(theo)}</td><td className="right tnum"><strong>{fSolde(total - theo)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        {l.anomalies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <strong className="sub">{plural(l.anomalies.length, 'point à justifier', 'points à justifier')}</strong>
            {l.anomalies.map(a => (
              <span key={`${a.jour}|${a.code}|${a.texte}`} className="sub"><Tag cls="tag-outline">{ANOMALIES_POINTAGE[a.code]}</Tag> {fmtShort(parse(a.jour))} — {a.texte}</span>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Détail des pointages" aside={plural(l.pointages.filter(p => p.annuleId == null && !neutralises.has(p.id)).length, 'pointage', 'pointages')}>
        {!l.pointages.length ? <Empty pad="sm">Aucun pointage cette semaine.</Empty> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Jour</th><th>Heure</th><th>Sens</th><th>Origine</th><th></th></tr></thead>
              <tbody>
                {jours.flatMap(j => parJour(j).filter(p => p.annuleId == null).map(p => {
                  const retire = neutralises.has(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="nowrap">{jourCourt(j)}</td>
                      <td className="tnum">{retire ? <s>{hhmmParis(p.horodatage)}</s> : hhmmParis(p.horodatage)}</td>
                      <td>{p.sens === 'S' ? 'Départ' : p.sens === 'E' ? 'Arrivée' : '—'}</td>
                      <td className="text-muted sub">{retire ? 'retiré par une correction' : p.source === 'correction' ? 'correction validée' : p.horsLigne ? 'différé (hors ligne)' : 'pointage'}</td>
                      <td className="right">
                        {peutCorriger && !retire && !enAttente.has(p.id) && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'correctionPointage', empId: emp.id, nature: 'neutralisation', pointageId: p.id, jour: p.jour, heure: hhmmParis(p.horodatage), sens: p.sens ?? undefined })}>
                            Retirer
                          </button>
                        )}
                        {enAttente.has(p.id) && <Tag cls="tag-outline">Retrait demandé</Tag>}
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
        <Fine>Une saisie n’est jamais modifiée : une correction ajoute un pointage, ou en retire un par une ligne qui le désigne. Après la validation de la feuille, la correction passe par sa réouverture (service RH).</Fine>
      </Panel>

      {corrections.length > 0 && <CorrectionsListe titre={soiMeme ? 'Mes demandes de correction' : 'Demandes de correction'} ids={corrections.map(c => c.id)} />}
    </>
  );
}

/** Demandes de correction (salarié, ou valideur sur la fiche d'un salarié) : objet, motif, statut, retrait d'une demande. */
function CorrectionsListe({ titre, ids }: { titre: string; ids: number[] }) {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { openDialog } = useStore();
  const liste = (d.ds.correctionsPointage ?? []).filter(c => ids.includes(c.id));
  return (
    <Panel title={titre}>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Demande</th><th>Motif</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {liste.map(c => (
              <tr key={c.id}>
                <td><Two main={objetCorrection(c)} sub={`${c.demandeParInteresse ? 'Demandée' : `Saisie par ${c.demandePar ?? 'le valideur'}`} le ${fmtIso(c.demandeLe.slice(0, 10))}`} /></td>
                <td className="text-muted sub">{motifCorrection(c)}{c.commentaire ? ` · ${c.commentaire}` : ''}</td>
                <td><Tag cls={STATUTS_CORRECTION[c.statut].cls}>{STATUTS_CORRECTION[c.statut].label}</Tag>{c.statut === 'refusee' && c.motifRefus && <div className="text-muted sub">{c.motifRefus}</div>}</td>
                <td className="right">
                  {c.statut === 'demandee' && (c.empId === me || valideurPointages(d, c.empId, { rh, manager, me, soi })) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: retraitCorrectionPointage(c, d.personName(c.empId), c.empId === me) })}>Retirer la demande</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** File des demandes de correction à décider (manager, suppléant « feuilles », service RH). */
export function CorrectionsAValider() {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  const { run, openDialog, go } = useStore();
  const { occupe, agir } = useAgir();
  const file = correctionsAValider(d, { rh, manager, me, soi });
  if (!file.length) return null;
  return (
    <Panel highlight title="Corrections de pointage à valider" aside={plural(file.length, 'demande', 'demandes')}>
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Collaborateur</th><th>Demande</th><th>Motif</th><th></th></tr></thead>
          <tbody>
            {file.map(c => {
              const e = d.emp(c.empId);
              const ouvrir = () => go('temps', { tsEmp: c.empId, weekStart: addD(c.jour, -((parse(c.jour).getDay() + 6) % 7)), tempsOnglet: 'pointages' });
              return (
                <tr key={c.id} className="clickable" onClick={ouvrir}>
                  <td><Two main={<Ouvrir onOpen={ouvrir}>{e?.nom ?? '—'}</Ouvrir>} sub={e ? equipeLabel(e) : undefined} nowrap /></td>
                  <td className="sub">{objetCorrection(c)}</td>
                  <td className="text-muted sub">{motifCorrection(c)}{c.commentaire ? ` · ${c.commentaire}` : ''}</td>
                  <td className="right">
                    <div className="actions-end">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={stop(() => openDialog({ type: 'confirmer', c: refusCorrectionPointage(c, d.personName(c.empId)) }))}>Refuser</button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={occupe} onClick={stop(agir(() => run('pointage.validerCorrection', { id: c.id })))}>Valider</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Fine>Une demande se fait sous {d.ds.settings.pointageDelaiCorrectionJours} jours. Validée, elle ajoute le pointage oublié ou retire le pointage erroné ; la feuille d’une semaine déjà validée passe d’abord par sa réouverture.</Fine>
    </Panel>
  );
}

/** Présences du jour du périmètre (manager, service RH) : sans la nature d'une absence, sans historique heure par heure. */
export function PresencesDuJour() {
  const d = useDomain();
  const { v, erreur } = useLecture<PresencesPointages>(() => api.presencesPointages(), [d.ds]);
  if (erreur && !v) return <Panel title="Présences du jour"><Empty>{erreur}</Empty></Panel>;
  if (!v) return <Panel title="Présences du jour"><Empty>Chargement…</Empty></Panel>;
  const liste = v.presences.map(p => ({ p, e: d.emp(p.empId) })).filter(x => !!x.e).sort((a, b) => a.e!.nom.localeCompare(b.e!.nom));
  const n = (etat: string) => liste.filter(x => x.p.etat === etat).length;
  return (
    <Panel title="Présences du jour" aside={liste.length ? `${n('present')} présent${n('present') > 1 ? 's' : ''} · ${n('non_pointe')} non pointé${n('non_pointe') > 1 ? 's' : ''}` : undefined}>
      {!liste.length ? <Empty pad="sm">Aucun salarié de votre périmètre ne pointe aujourd’hui.</Empty> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Collaborateur</th><th>État</th><th className="right">À justifier</th></tr></thead>
            <tbody>
              {liste.map(({ p, e }) => (
                <tr key={p.empId}>
                  <td><Two main={e!.nom} sub={equipeLabel(e!)} nowrap /></td>
                  <td><Tag cls={PRESENCES[p.etat]?.cls ?? 'tag-outline'}>{PRESENCES[p.etat]?.label ?? p.etat}{p.depuis ? ` depuis ${p.depuis}` : ''}</Tag></td>
                  <td className="right tnum">{p.anomalies || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fine>Outil d’organisation du jour : la nature d’une absence n’est jamais montrée, et le détail heure par heure reste sur la semaine du salarié.</Fine>
    </Panel>
  );
}
