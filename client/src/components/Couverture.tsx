// Couverture minimale des équipes en SST et équipiers incendie (t067, shared/rules/couverture.ts) : alertes du tableau de
// bord (service RH, référent HSE, lecture seule), de l'équipe du manager, des Échéances et d'Équipes & managers ; cellule
// de l'onglet Postes des Référentiels. L'état vient du serveur (`Dataset.couverture`, calculé sur l'instantané complet,
// le référent HSE ne recevant pas toutes les absences) ; à défaut, il est calculé ici.
import { useMemo, type CSSProperties } from 'react';
import { parse } from '../../../shared/dates.ts';
import { fmtShort, plural } from '../../../shared/format.ts';
import { causesTexte, couvertureTexte, etatsCouverture, manqueImmediat } from '../../../shared/rules/couverture.ts';
import type { EtatCouverture } from '../../../shared/types.ts';
import { useDomain, useIntentPermis } from '../state/derived.ts';
import { useAgir } from '../state/actions.ts';
import { useStore } from '../state/store.tsx';
import { Chips, Fine, Panel, Tag, Two } from './ui.tsx';

/** États de couverture de l'instantané (toutes les équipes reçues), ou de celles nommées. */
export function useCouverture(equipes?: readonly string[]): EtatCouverture[] {
  const d = useDomain();
  return useMemo(() => {
    const tous = d.ds.couverture ?? etatsCouverture(d.ds, d.ds.settings.horizonAlerte);
    return equipes ? tous.filter(x => equipes.includes(x.equipe)) : tous;
  }, [d, equipes]);
}

/** Cellule « Couverture minimale » (Référentiels → Postes) : une étiquette par formation, en accent si le minimum manque. */
export function CouvertureCellule({ equipe }: { equipe: string }) {
  const d = useDomain();
  const liste = useCouverture(useMemo(() => [equipe], [equipe]));
  const q = d.ds.referentiels.equipes.find(x => x.nom === equipe);
  if (!q?.couverture?.length) return <span className="text-muted">Aucun seuil</span>;
  return (
    <Chips items={q.couverture.map(l => {
      const x = liste.find(y => y.formation === l.formation);
      const court = d.fm(l.formation)?.court ?? l.formation;
      return { key: l.formation, label: x ? `${court} ${x.compte}/${l.min}` : `${court} · ${l.min} min.`, cls: !x ? 'tag-outline' : x.manque ? 'tag-accent' : 'tag-neutral' };
    })} />
  );
}

/** Une ligne d'alerte : équipe, formation, date et causes, prochaine session et action « Inscrire ». */
function Alerte({ x, equipe }: { x: EtatCouverture; equipe: boolean }) {
  const d = useDomain();
  const permis = useIntentPermis();
  const { runIntent } = useStore();
  const { occupe, agir } = useAgir();
  const fm = d.fm(x.formation), court = fm?.court ?? x.formation;
  const prochaine = d.upcoming().find(s => s.formation === x.formation && s.inscrits < s.places);
  const intent = { type: 'goFormation' as const, f: x.formation };
  const immediat = manqueImmediat(x, d.ti);
  return (
    <div className="list-row stack">
      <div className="item-head">
        <div style={{ minWidth: 0 }}><Two main={equipe ? `Équipe ${x.equipe} · ${court}` : court} sub={couvertureTexte(x, court, d.ti)} /></div>
        <Tag cls={immediat ? 'tag-accent' : 'tag-outline'} style={{ flex: 'none' }}>{immediat ? 'Sous le minimum' : 'À anticiper'}</Tag>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span className="text-muted sub">{causesTexte(x.manque!.causes)}{prochaine ? ` · prochaine session le ${fmtShort(parse(prochaine.date))}` : ' · aucune session ouverte'}</span>
        {permis(intent) && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={occupe} onClick={agir(() => runIntent(intent))}>
            {prochaine ? 'Inscrire à la prochaine session' : 'Voir les sessions'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Panneau des couvertures en défaut, aujourd'hui ou sous l'horizon d'alerte (`equipes` : seulement celles-ci). Rien quand
 * le minimum est tenu partout, ou qu'aucun seuil n'est saisi.
 */
export function CouverturePanel({ equipes, style }: { equipes?: readonly string[]; style?: CSSProperties }) {
  const liste = useCouverture(equipes).filter(x => x.manque).sort((a, b) => a.manque!.le.localeCompare(b.manque!.le));
  if (!liste.length) return null;
  return (
    <Panel highlight style={style} title="Couverture minimale des équipes"
      aside={`${plural(liste.length, 'seuil non tenu', 'seuils non tenus')} · secouristes et équipiers d’intervention`}>
      <div className="list">{liste.map(x => <Alerte key={`${x.equipe}-${x.formation}`} x={x} equipe />)}</div>
      <Fine>
        Membres présents, sans absence en cours, titulaires d’une certification valide, chaque jour jusqu’à l’horizon d’alerte. Un
        recyclage planifié ne compte qu’une fois la certification enregistrée. Seuils : Référentiels → Postes, exigences communes de l’équipe.
      </Fine>
    </Panel>
  );
}

/** Couverture d'une équipe (Équipes & managers) : chaque seuil, tenu ou non. */
export function CouvertureEquipe({ equipe }: { equipe: string }) {
  const d = useDomain();
  const liste = useCouverture(useMemo(() => [equipe], [equipe]));
  if (!liste.length) return null;
  return (
    <div className="list">
      {liste.map(x => x.manque ? <Alerte key={x.formation} x={x} equipe={false} /> : (
        <div key={x.formation} className="list-row">
          <div className="grow"><Two main={d.fm(x.formation)?.court ?? x.formation} sub={couvertureTexte(x, d.fm(x.formation)?.court ?? x.formation, d.ti)} /></div>
          <Tag cls="tag-neutral" style={{ flex: 'none' }}>Couverture tenue</Tag>
        </div>
      ))}
    </div>
  );
}
