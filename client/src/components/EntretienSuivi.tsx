// Blocs « Objectifs » et « Souhaits de formation » du compte rendu d'entretien (lot 12, chantier C3, t194), rendus par
// dialogs/EntDialog.tsx sous les sections rédigées :
// - entretien annuel : objectifs de la période précédente à évaluer (atteint, partiellement, non atteint, sans objet,
//   reconduit), puis objectifs fixés à cet entretien (par l'évaluateur, ou proposés par le salarié et validés) ;
// - point de mi-année et point de suivi : objectifs en cours, leur avancement et leur ajustement (avec un motif) ;
// - jamais dans un entretien de parcours professionnel, de reprise, l'état des lieux ni le forfait jours (art. L6315-1 ;
//   le serveur le refuse aussi) ;
// - souhaits de formation (parcours professionnel, reprise, annuel, mi-année), avec l'avis du manager ; à la clôture, seuls
//   les souhaits à avis favorable deviennent une demande au service RH, dont l'état s'affiche ensuite ici.
// Évaluateur : service RH (jamais pour soi-même), manager valideur ou suppléant d'une délégation « entretiens », comme
// le serveur (`isValidatorOf(ctx, e, 'entretiens')`). Chaque saisie s'ouvre dans son dialogue (`ouvrir`), après
// l'enregistrement des sections en cours du compte rendu.
import type { ReactNode } from 'react';
import { REQ_CLS, REQ_LABEL } from '../../../shared/constants.ts';
import { fmtIso, plural } from '../../../shared/format.ts';
import {
  blocageClotureObjectifs, CATEGORIE_OBJECTIF_LABEL, estEvalue, objectifsDuCompteRendu, STATUT_OBJECTIF_LABEL, TYPES_AVEC_OBJECTIFS, TYPES_FIXATION,
} from '../../../shared/rules/objectifs.ts';
import {
  AVIS_SOUHAIT, AVIS_SOUHAIT_LABEL, NON_VERSE_LABEL, PRIORITE_SOUHAIT_LABEL, souhaitsDe, souhaitsSansAvis, souhaitTraite, TYPES_SOUHAITS,
} from '../../../shared/rules/souhaits.ts';
import type { AvisSouhait, Employe, Entretien, Objectif, SouhaitFormation, StatutObjectif } from '../../../shared/types.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { decideur } from '../state/delegues.ts';
import { retraitProposition } from '../state/confirmations-objectifs.ts';
import { type DialogState, useStore } from '../state/store.tsx';
import { Bar, Fine, NoteAccent, SectionLabel, Tag } from './ui.tsx';

/** Classe de l'étiquette d'un statut d'objectif. */
export const STATUT_OBJECTIF_CLS: Record<StatutObjectif, string> = {
  propose: 'tag-outline', ouvert: 'tag-neutral', atteint: 'tag-neutral', partiel: 'tag-outline', non_atteint: 'tag-accent', sans_objet: 'tag-outline', reconduit: 'tag-outline',
};

/** Détail d'un objectif sur une ligne : catégorie, poids, échéance. */
export const detailObjectif = (o: Objectif) => [
  CATEGORIE_OBJECTIF_LABEL[o.categorie], o.poids != null ? `poids ${o.poids} %` : '', o.echeance ? `échéance le ${fmtIso(o.echeance)}` : '',
  o.reconduitDe ? 'reconduit de la période précédente' : '', o.ajusteLe ? `ajusté le ${fmtIso(o.ajusteLe)}` : '',
].filter(Boolean).join(' · ');

/** Intitulé d'un souhait : la formation du catalogue, ou l'intitulé libre. */
export function nomSouhait(d: ReturnType<typeof useDomain>, s: Pick<SouhaitFormation, 'f' | 'libelle'>): string {
  return s.f ? d.ds.referentiels.formations.find(y => y.id === s.f)?.nom ?? s.f : s.libelle ?? '';
}

/** Personne connectée évaluateur de ce salarié (même règle que le serveur) ; jamais pour soi-même. */
export function useEvaluateur(e: Pick<Employe, 'id' | 'equipe'> | undefined): boolean {
  const d = useDomain();
  const { rh, manager, me, soi } = useRole();
  return !!e && e.id !== soi && (rh || (manager && decideur(d, e, me, 'entretiens')));
}

export function EntretienSuivi({ x, e, ouvrir }: { x: Entretien; e: Employe; ouvrir: (dlg: DialogState) => void }) {
  const d = useDomain();
  const { collab, me } = useRole();
  const { run } = useStore();
  const evaluateur = useEvaluateur(e);
  const salarie = collab && x.empId === me;
  const planifie = x.statut === 'planifie';
  const s = d.ds.settings;
  const objectifs = d.ds.objectifs ?? [];
  // Annuel clos : ses objectifs (fixés ou évalués à cet entretien) restent affichés même réglage coupé ; la saisie, non.
  const { avec: avecObjectifs, aRevoir, fixes } = objectifsDuCompteRendu(objectifs, d.ds.entretiens, x, s);
  const fixation = TYPES_FIXATION.includes(x.type);
  const avecSouhaits = TYPES_SOUHAITS.includes(x.type);
  if (!avecObjectifs && !avecSouhaits) return null;

  // Point de mi-année, point de suivi : les objectifs en cours du salarié, fixés à un entretien clos.
  const clos = new Set(d.ds.entretiens.filter(y => y.statut === 'realise').map(y => y.id));
  const enCours = fixation ? [] : objectifs.filter(o => o.empId === e.id && o.statut === 'ouvert' && clos.has(o.entretienId));
  const blocage = evaluateur && planifie && fixation ? blocageClotureObjectifs(objectifs, d.ds.entretiens, x, s) : null;
  const poidsTotal = fixes.reduce((t, o) => t + (o.poids ?? 0), 0);
  const souhaits = souhaitsDe(x);
  const sansAvis = souhaitsSansAvis(x).length;

  /** Boutons de suivi d'un objectif en cours (entretien de fixation clos) : avancement, ajustement. */
  const suivi = (o: Objectif) => s.objectifsActifs && o.statut === 'ouvert' && clos.has(o.entretienId) && (<>
    {(evaluateur || (collab && o.empId === me)) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'objectifAvancer', id: o.id, retour: x.id })}>Avancement</button>}
    {evaluateur && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'ajuster', id: o.id, retour: x.id })}>Ajuster</button>}
  </>);

  const ligne = (o: Objectif, actions: ReactNode, evaluation = false) => (
    <div key={o.id} className="list-row stack">
      <div className="item-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14 }}>{o.libelle}</div>
          <div className="text-muted sub">{detailObjectif(o)}</div>
          {o.mesure && <div className="text-muted sub">Mesure : {o.mesure}</div>}
          {o.statut === 'ouvert' && clos.has(o.entretienId) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
              <Bar pct={o.avancement} width={120} /><span className="text-muted sub tnum">{o.avancement} %</span>
            </div>
          )}
          {o.commentaireSal && <div className="text-muted sub">Commentaire du salarié : {o.commentaireSal}</div>}
          {evaluation && o.evaluation && <div className="text-muted sub">Évaluation : {o.evaluation}</div>}
        </div>
        {/* Fixé à un entretien encore planifié : pas encore « en cours ». */}
        <Tag cls={STATUT_OBJECTIF_CLS[o.statut]} style={{ flex: 'none' }}>{o.statut === 'ouvert' && !clos.has(o.entretienId) ? 'Fixé' : STATUT_OBJECTIF_LABEL[o.statut]}</Tag>
      </div>
      {actions && <div className="actions-end">{actions}</div>}
    </div>
  );

  const avis = (sh: SouhaitFormation) => {
    if (souhaitTraite(sh)) {
      const r = sh.demandeId ? d.ds.demandesCollab.find(y => y.id === sh.demandeId) : undefined;
      if (sh.nonVerse) return <Tag cls="tag-outline">{NON_VERSE_LABEL[sh.nonVerse]}</Tag>;
      return r ? <Tag cls={REQ_CLS[r.statut]}>Demande {REQ_LABEL[r.statut].toLowerCase()}</Tag> : <Tag cls="tag-neutral">Versé au service RH</Tag>;
    }
    if (evaluateur && planifie) {
      return (
        <select className="input" aria-label={`Avis sur le souhait ${nomSouhait(d, sh)}`} value={sh.avis ?? ''} style={{ width: 'auto', minWidth: 140 }}
          onChange={ev => run('entretien.avisSouhait', { id: x.id, cle: sh.cle, avis: ev.target.value || null })}>
          <option value="">Avis à donner</option>
          {AVIS_SOUHAIT.map(a => <option key={a} value={a}>{AVIS_SOUHAIT_LABEL[a]}</option>)}
        </select>
      );
    }
    return <Tag cls={sh.avis === 'favorable' ? 'tag-neutral' : 'tag-outline'}>{sh.avis ? `Avis ${AVIS_SOUHAIT_LABEL[sh.avis as AvisSouhait].toLowerCase()}` : 'Sans avis'}</Tag>;
  };

  return (<>
    {avecObjectifs && fixation && aRevoir.length > 0 && (<>
      <SectionLabel>Objectifs de la période précédente</SectionLabel>
      <div className="list">
        {aRevoir.map(o => ligne(o, evaluateur && planifie
          ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'objectifEvaluer', id: o.id, entretienId: x.id, retour: x.id })}>{estEvalue(o) ? 'Modifier l’évaluation' : 'Évaluer'}</button>
          : suivi(o), true))}
      </div>
      <Fine>
        {s.objectifsFacultatifs
          ? 'Objectifs facultatifs (première année) : l’évaluation n’est pas exigée pour clore l’entretien.'
          : 'Chaque objectif de la période précédente est évalué avant la clôture : atteint, partiellement, non atteint, sans objet ou reconduit.'}
      </Fine>
    </>)}
    {avecObjectifs && fixation && (<>
      <SectionLabel>Objectifs {planifie ? 'de la période à venir' : 'fixés à cet entretien'}</SectionLabel>
      {fixes.length > 0 ? (
        <div className="list">
          {fixes.map(o => ligne(o, planifie ? (<>
            {evaluateur && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'modifier', id: o.id, retour: x.id })}>{o.statut === 'propose' ? 'Valider ou reformuler' : 'Modifier'}</button>}
            {salarie && o.statut === 'propose' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'confirmer', c: retraitProposition(o, x.id) })}>Retirer ma proposition</button>}
          </>) : suivi(o)))}
        </div>
      ) : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{planifie ? 'Aucun objectif fixé pour l’instant.' : 'Aucun objectif fixé à cet entretien.'}</p>}
      {planifie && (evaluateur || salarie) && (
        <div className="actions-end" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="text-muted sub">{plural(fixes.length, 'objectif', 'objectifs')} sur {s.objectifsMax} au plus{poidsTotal ? ` · poids réparti ${poidsTotal} %` : ''}</span>
          {fixes.length < s.objectifsMax && (evaluateur
            ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'ajouter', entretienId: x.id, retour: x.id })}>Fixer un objectif</button>
            : <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'objectif', mode: 'proposer', entretienId: x.id, retour: x.id })}>Proposer un objectif</button>)}
        </div>
      )}
      {blocage && <NoteAccent>{blocage}.</NoteAccent>}
    </>)}
    {avecObjectifs && !fixation && (<>
      <SectionLabel>Objectifs en cours</SectionLabel>
      {enCours.length > 0
        ? <div className="list">{enCours.map(o => ligne(o, suivi(o)))}</div>
        : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucun objectif en cours : ils se fixent à l’entretien annuel.</p>}
      <Fine>Point de suivi : l’avancement se met à jour et un objectif s’ajuste avec un motif ; l’évaluation se fait à l’entretien annuel.</Fine>
    </>)}
    {avecSouhaits && (<>
      <SectionLabel>Souhaits de formation</SectionLabel>
      {souhaits.length > 0 ? (
        <div className="list">
          {souhaits.map(sh => {
            // Objectif lié : seulement dans un entretien qui porte des objectifs (jamais un parcours professionnel, L6315-1).
            const objectif = sh.objectifId && TYPES_AVEC_OBJECTIFS.includes(x.type) ? objectifs.find(o => o.id === sh.objectifId) : undefined;
            const modifiable = planifie && !souhaitTraite(sh) && ((salarie && sh.auteur === 'sal') || (evaluateur && sh.auteur === 'mgr'));
            return (
              <div key={sh.cle} className="list-row stack">
                <div className="item-head">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{nomSouhait(d, sh)}</div>
                    <div className="text-muted sub">
                      {sh.auteur === 'sal' ? 'Exprimé par le salarié' : 'Proposé par l’évaluateur'} · priorité {PRIORITE_SOUHAIT_LABEL[sh.priorite].toLowerCase()}
                      {objectif ? ` · pour l’objectif « ${objectif.libelle} »` : ''}{sh.verseLe ? ` · traité le ${fmtIso(sh.verseLe)}` : ''}
                    </div>
                  </div>
                  <div style={{ flex: 'none' }}>{avis(sh)}</div>
                </div>
                {modifiable && (
                  <div className="actions-end">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrir({ type: 'souhait', entretienId: x.id, cle: sh.cle })}>Modifier</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Aucun souhait de formation exprimé.</p>}
      {planifie && (evaluateur || salarie) && (
        <div className="actions-end">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir({ type: 'souhait', entretienId: x.id })}>Ajouter un souhait</button>
        </div>
      )}
      {planifie && evaluateur && sansAvis > 0 && <NoteAccent>{plural(sansAvis, 'souhait attend', 'souhaits attendent')} votre avis : seuls les souhaits à avis favorable deviennent une demande au service RH à la clôture.</NoteAccent>}
      <Fine>À la clôture, chaque souhait à avis favorable devient une demande de formation au service RH, qui décide (session, liste d’attente ou plan de formation) ; les autres restent au compte rendu.</Fine>
    </>)}
  </>);
}
