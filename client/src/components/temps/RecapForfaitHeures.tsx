// Onglet « Forfait annuel en heures » de l'écran Temps de travail (lot 12, chantier C1, étape 2 ; règles :
// shared/rules/forfait-heures.ts, droits de lecture : components/temps/forfait-heures-vue.ts) :
// - service RH : bandeau des clôtures à faire (plages terminées par période de référence, lignes « à revoir »), ouverture
//   du dialogue de clôture (administrateur RH, dialogs/ClotureForfaitHeuresDialog.tsx) ;
// - suivi de la période en cours, un salarié par ligne : réalisé (feuilles validées sous forfait), cible, projection de fin de
//   plage au rythme des feuilles validées, état de la clôture ; cible nette des absences et heures de paie pour le service
//   RH, la paie et le salarié lui-même seulement ;
// - lignes de clôture enregistrées (service RH, paie) : quantités, état (à confirmer, confirmée, dans un lot, transmise,
//   réglée hors fichier), « à revoir » ; réouverture et annulation avec motif (administrateur RH, jamais pour soi-même :
//   state/confirmations-forfait-heures.ts) ;
// - le collaborateur : son récapitulatif détaillé et ses clôtures confirmées.
import { useMemo, useState } from 'react';
import type { Domain } from '../../../../shared/domain.ts';
import { isoParis } from '../../../../shared/dates.ts';
import { equipeLabel, fH, fmtIso, plural } from '../../../../shared/format.ts';
import {
  aRevoir, absencesDeduites, DUREE_LEGALE_ANNUELLE, heuresParJour, lignesARevoir, periodeReference, plagesAClore, suiviForfaitHeures, type ClotureForfaitHeures,
  type SuiviForfaitHeures,
} from '../../../../shared/rules/forfait-heures.ts';
import type { Employe } from '../../../../shared/types.ts';
import { useDomain, useRole } from '../../state/derived.ts';
import { annulationClotureForfait, rouvertureClotureForfait } from '../../state/confirmations-forfait-heures.ts';
import { useStore } from '../../state/store.tsx';
import { Empty, Fine, Panel, Tag, Two } from '../ui.tsx';
import {
  etatTexte, groupesAClore, groupeTexte, heuresDuesTexte, periodeTexte, plageTexte, salariesForfaitHeures, voitQuantites, type DroitsForfaitHeures,
} from './forfait-heures-vue.ts';

/** Lignes enregistrées affichées avant « Afficher tout l'historique ». */
const LIGNES_VISIBLES = 10;

/** Droits de la personne connectée pour le forfait (forfait-heures-vue.ts). */
export function useDroitsForfaitHeures(): DroitsForfaitHeures {
  const { rh, paie, consultation, manager, collab, soi } = useRole();
  return useMemo(() => ({ rh, paie, consultation, manager, collab, soi }), [rh, paie, consultation, manager, collab, soi]);
}

/** Projection de fin de plage : « 1 650 h au rythme actuel (feuilles validées jusqu'au 4 oct. 2026) ». */
const projectionTexte = (s: SuiviForfaitHeures) =>
  (s.projection == null ? 'moins de 4 semaines de feuilles validées : pas encore de projection' : `${fH(s.projection)} au rythme des feuilles validées jusqu’au ${fmtIso(s.couvertJusquau!)}`);

export function RecapForfaitHeures() {
  const d = useDomain();
  const r = useDroitsForfaitHeures();
  const ref = periodeReference(d.ds.settings, d.ti);
  return (
    <>
      {r.rh && <BandeauClotureForfaitHeures />}
      {r.collab
        ? <MonForfaitHeures />
        : <SuiviForfaitHeuresPanel d={d} r={r} titre={`Suivi du forfait annuel en heures · ${periodeTexte(ref)}`} />}
      {(r.rh || r.paie || r.collab) && <LignesForfaitHeures />}
      <Fine>
        Cible : forfait au prorata des jours de la plage sous forfait (entrée, début du suivi le {fmtIso(d.ds.settings.forfaitHeuresDebutSuivi)}, sortie, avenant),
        moins les absences déduites ({absencesDeduites(d.ds.settings).length === 0 ? 'aucune' : 'toutes hors congés payés légaux, fériés chômés et journée de solidarité, liste réglable'})
        {d.ds.settings.forfaitHeuresJour ? `, ${fH(d.ds.settings.forfaitHeuresJour)} par jour ouvré` : ', au forfait divisé par les jours ouvrés théoriques de la période'}.
        Au-delà de la cible nette : 25 % jusqu’à {fH(d.ds.settings.forfaitHeuresSeuil25)} par semaine travaillée sous forfait, 50 % au-delà (HFA25, HFA50) ; sous {DUREE_LEGALE_ANNUELLE.toLocaleString('fr-FR')} h,
        heures complémentaires à 10 % puis 25 % (HCA10, HCA25). Heures non réalisées : affichées, jamais retenues.{r.collab || r.manager ? '' : ' Réglages : Paramètres → Décompte des heures.'}
      </Fine>
    </>
  );
}

/** Bandeau du service RH : clôtures à faire par période de référence, lignes à revoir. */
export function BandeauClotureForfaitHeures() {
  const d = useDomain();
  const { admin } = useRole();
  const { openDialog } = useStore();
  const groupes = useMemo(() => groupesAClore(d, plagesAClore(d)), [d]);
  const revoir = useMemo(() => lignesARevoir(d), [d]);
  if (!groupes.length && !revoir.length) return null;
  return (
    <Panel highlight title="Clôtures du forfait annuel en heures à faire" aside="Proposées par Cursus, confirmées par l’administrateur RH">
      <div className="list">
        {groupes.map(g => (
          <div key={g.reference.debut} className="list-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>Forfait annuel en heures · {periodeTexte(g.reference)}{g.enCours ? '' : ` · terminée le ${fmtIso(g.reference.fin)}`}</div>
              <div className="text-muted sub">{groupeTexte(g)}</div>
            </div>
            {admin
              ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'clotureForfaitHeures', periode: g.reference.debut })}>Clôturer</button>
              : <span className="text-muted sub">Clôture par l’administrateur RH</span>}
          </div>
        ))}
        {revoir.map(({ ligne, motif }) => (
          <div key={ligne.id} className="list-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{d.personName(ligne.empId)} · clôture à revoir</div>
              <div className="text-muted sub">{plageTexte(ligne)} · {motif} · rouvrir la ligne pour la recalculer</div>
            </div>
            <Tag cls="tag-accent">À revoir</Tag>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Suivi de la période en cours : un salarié par ligne (le service RH, la paie, la lecture seule, le manager). */
function SuiviForfaitHeuresPanel({ d, r, titre }: { d: Domain; r: DroitsForfaitHeures; titre: string }) {
  const lignes = useMemo(() => salariesForfaitHeures(d, periodeReference(d.ds.settings, d.ti)).flatMap(e => suiviForfaitHeures(d, e).map(s => ({ e, s }))), [d]);
  if (!lignes.length) {
    return <Panel title={titre}><Empty pad="sm">Aucun salarié au forfait annuel en heures dans la période.</Empty></Panel>;
  }
  const quantites = lignes.some(({ e }) => voitQuantites(r, e.id));
  return (
    <Panel title={titre} aside={plural(new Set(lignes.map(x => x.e.id)).size, 'salarié', 'salariés')}>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Collaborateur</th><th>Plage</th><th className="right">Réalisé</th>
              <th className="right">{quantites ? 'Cible nette' : 'Cible'}</th><th className="right">Projection</th>{quantites && <th>Clôture</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map(({ e, s }) => {
              const q = voitQuantites(r, e.id), c = s.calc;
              return (
                <tr key={`${e.id}|${c.debut}`}>
                  <td><Two main={e.nom} sub={equipeLabel(e)} nowrap /></td>
                  <td><Two main={`${fmtIso(c.debut)} → ${fmtIso(c.fin)}`} sub={`${fH(c.forfait)}${s.enCours ? ' · en cours' : ' · terminée'}`} nowrap /></td>
                  <td className="right tnum">{fH(c.realise)}</td>
                  <td className="right">
                    {q ? <Two main={<span className="tnum">{fH(c.cibleNette)}</span>} sub={c.absences ? `${fH(c.cible)} − ${fH(c.absences)} d’absences` : undefined} />
                      : <span className="tnum">{fH(c.cible)}</span>}
                  </td>
                  <td className="right">
                    <Two main={<span className="tnum">{s.projection == null ? '—' : fH(s.projection)}</span>}
                      sub={s.projection != null && s.couvertJusquau ? `au ${fmtIso(s.couvertJusquau)}` : undefined} />
                  </td>
                  {quantites && <td>{q ? <EtatSuivi s={s} /> : <span className="text-muted">—</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!quantites && <Fine>Réalisé des feuilles validées et cible au prorata de la présence ; les absences déduites et les heures de paie restent au service RH.</Fine>}
    </Panel>
  );
}

/** État de la clôture d'une plage suivie. */
function EtatSuivi({ s }: { s: SuiviForfaitHeures }) {
  if (s.ligne) return <Two main={etatTexte(s.ligne, null)} sub={s.revoir ? `à revoir : ${s.revoir}` : undefined} />;
  return <span className="text-muted">{s.enCours ? 'période en cours' : 'à clôturer'}</span>;
}

/** Récapitulatif du collaborateur : sa plage de la période en cours, puis ses clôtures confirmées. */
function MonForfaitHeures() {
  const d = useDomain();
  const { me } = useRole();
  const e = me != null ? d.emp(me) : undefined;
  const suivis = useMemo(() => (e ? suiviForfaitHeures(d, e) : []), [d, e]);
  const ref = periodeReference(d.ds.settings, d.ti);
  if (!e || !suivis.length) {
    return <Panel title={`Mon forfait annuel en heures · ${periodeTexte(ref)}`}><Empty pad="sm">Aucune période sous forfait annuel en heures cette année.</Empty></Panel>;
  }
  return <>{suivis.map(s => <FicheSuivi key={s.calc.debut} e={e} s={s} titre={`Mon forfait annuel en heures · ${periodeTexte(ref)}`} />)}</>;
}

/** Détail d'une plage suivie, pour le salarié lui-même. */
function FicheSuivi({ e, s, titre }: { e: Employe; s: SuiviForfaitHeures; titre: string }) {
  const d = useDomain();
  const c = s.calc;
  const ecartProjete = s.projection == null ? null : s.projection - c.cibleNette;
  const rows: [string, string][] = [
    ['Plage sous forfait', plageTexte(c)],
    ['Forfait', fH(c.forfait)],
    ['Réalisé validé', fH(c.realise)],
    ['Cible au prorata', fH(c.cible)],
    ['Absences déduites', c.absences ? `${fH(c.absences)} (${fH(heuresParJour(d.ds.settings, c.forfait, c.reference))} par jour ouvré)` : 'aucune'],
    ['Cible nette', fH(c.cibleNette)],
    ['Projection de fin de plage', projectionTexte(s)],
  ];
  if (ecartProjete != null) rows.push(['Écart projeté', `${ecartProjete > 0 ? '+' : ''}${fH(ecartProjete)}`]);
  if (!s.enCours) rows.push(['Heures dues à ce jour', heuresDuesTexte(c)]);
  return (
    <Panel title={titre} aside={e.nom}>
      <div className="list">
        {rows.map(([k, v]) => (
          <div key={k} className="list-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow text-muted sub">{k}</div>
            <div className="tnum" style={{ fontSize: 14 }}>{v}</div>
          </div>
        ))}
      </div>
      <Fine>
        {s.ligne ? `Clôture : ${etatTexte(s.ligne, null)}.` : s.enCours ? 'La plage sera clôturée par le service RH à sa fin ; vos heures au-delà de la cible nette vous seront alors payées.' : 'Plage terminée : clôture à faire par le service RH.'}
        {' '}Projection indicative, au rythme de vos feuilles validées ; les heures non réalisées ne sont jamais retenues.
      </Fine>
    </Panel>
  );
}

/** Jour de Paris d'un horodatage. */
const jour = (at: string) => fmtIso(isoParis(new Date(at)));

/** Confirmation, réouverture ou annulation d'une ligne : date, auteur et, pour le service RH, motif. */
function historiqueTexte(l: ClotureForfaitHeures, rh: boolean): string | undefined {
  if (l.statut === 'annulee' && l.annuleeLe) return `annulée le ${jour(l.annuleeLe)}${l.annuleePar ? ` · ${l.annuleePar}` : ''}${rh && l.annuleeMotif ? ` · motif : ${l.annuleeMotif}` : ''}`;
  if (l.statut === 'proposee' && l.rouverteLe) return `rouverte le ${jour(l.rouverteLe)}${l.rouvertePar ? ` · ${l.rouvertePar}` : ''}${rh && l.rouverteMotif ? ` · motif : ${l.rouverteMotif}` : ''}`;
  return l.confirmeeLe ? `confirmée le ${jour(l.confirmeeLe)}${l.confirmeePar ? ` · ${l.confirmeePar}` : ''}` : undefined;
}

/** Lignes de clôture enregistrées (service RH, paie, le collaborateur pour les siennes), les plus récentes d'abord. */
function LignesForfaitHeures() {
  const d = useDomain();
  const { admin, rh, collab, soi } = useRole();
  const { openDialog } = useStore();
  const [tout, setTout] = useState(false);
  const lignes = useMemo(() => [...(d.ds.cloturesForfaitHeures ?? [])].filter(l => l.statut !== 'annulee' || rh)
    .sort((a, b) => b.debut.localeCompare(a.debut) || a.empId - b.empId || b.version - a.version), [d, rh]);
  if (!lignes.length) return collab ? null : <Panel title="Clôtures enregistrées"><Empty pad="sm">Aucune clôture enregistrée.</Empty></Panel>;
  const derniere = (l: ClotureForfaitHeures) => !lignes.some(x => x.empId === l.empId && x.debut === l.debut && x.version > l.version);
  const actions = (l: ClotureForfaitHeures) => {
    if (!admin || l.empId === soi || !derniere(l) || l.statut === 'annulee') return null;
    const nom = d.personName(l.empId);
    const rouvrir = l.statut === 'confirmee' && !(l.lotId != null && !l.sage);
    const annuler = !l.sage && l.lotId == null;
    return (
      <div className="actions-end">
        {l.statut === 'proposee' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDialog({ type: 'clotureForfaitHeures', periode: periodeReference(d.ds.settings, l.debut).debut })}>Confirmer</button>}
        {rouvrir && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: rouvertureClotureForfait(l, nom) })}>Rouvrir</button>}
        {annuler && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'confirmer', c: annulationClotureForfait(l, nom) })}>Annuler</button>}
      </div>
    );
  };
  return (
    <Panel title={collab ? 'Mes clôtures du forfait annuel en heures' : 'Clôtures enregistrées'} aside={plural(lignes.length, 'ligne', 'lignes')}>
      <div className="scroll-x">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>{!collab && <th>Collaborateur</th>}<th>Plage</th><th className="right">Cible nette</th><th className="right">Réalisé</th><th>Heures</th><th>État</th>{admin && <th></th>}</tr>
          </thead>
          <tbody>
            {(tout ? lignes : lignes.slice(0, LIGNES_VISIBLES)).map(l => {
              const revoir = l.statut === 'confirmee' && derniere(l) && !collab ? aRevoir(d, l) : null;
              return (
                <tr key={l.id}>
                  {!collab && <td><Two main={d.personName(l.empId)} sub={l.version > 1 ? `version ${l.version}` : undefined} nowrap /></td>}
                  <td><Two main={`${fmtIso(l.debut)} → ${fmtIso(l.fin)}`} sub={`${fH(l.forfait)} · ${l.motifFin === 'periode' ? 'fin de période' : l.motifFin === 'sortie' ? 'sortie' : 'avenant'}`} /></td>
                  <td className="right"><Two main={<span className="tnum">{fH(l.cible - l.absences)}</span>} sub={l.absences ? `${fH(l.cible)} − ${fH(l.absences)}` : undefined} /></td>
                  <td className="right tnum">{fH(l.realise)}</td>
                  <td>{heuresDuesTexte(l)}</td>
                  <td>
                    <Two main={<>{l.statut === 'annulee' ? <Tag cls="tag-neutral">Annulée</Tag> : etatTexte(l, null)}{revoir && <> <Tag cls="tag-accent">À revoir</Tag></>}</>}
                      sub={revoir ?? historiqueTexte(l, rh)} />
                  </td>
                  {admin && <td className="right">{actions(l)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lignes.length > LIGNES_VISIBLES && (
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setTout(x => !x)}>{tout ? 'Afficher les dernières lignes' : `Afficher tout l’historique (${lignes.length} lignes)`}</button></div>
      )}
      {rh && <Fine>Motifs de réouverture et d’annulation : visibles du seul service RH, jamais transmis à la paie, au salarié ni au journal des actions.</Fine>}
    </Panel>
  );
}
