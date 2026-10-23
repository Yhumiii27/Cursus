// Délégation des validations d'un manager absent (t135, shared/rules/delegations-manager.ts) : délégations d'un manager
// (en cours, à venir, les dernières passées), bouton « Déléguer mes validations » ou « Déléguer les validations », et
// révocation après confirmation. Affiché dans Mon espace (le manager pour lui-même ; le suppléant pour ce qu'il a reçu)
// et dans le détail d'une équipe (écran Équipes & managers, service RH ; la lecture seule consulte).
import { fmtIso } from '../../../shared/format.ts';
import type { Domain } from '../../../shared/domain.ts';
import { ETAT_DELEGATION, etatDelegation, perimetreEffectif, perimetreTexte, valideursDe } from '../../../shared/rules/delegations-manager.ts';
import type { DelegationValidation, Employe } from '../../../shared/types.ts';
import { revocationDelegation } from '../state/confirmations-delegations.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { Btn, Empty, Fine, Panel, Tag } from './ui.tsx';

/** Délégations passées gardées à l'écran (les plus récentes). */
const PASSEES_MAX = 3;

/** Délégations à afficher : en cours et à venir, puis les dernières terminées ou révoquées. */
function aAfficher(liste: DelegationValidation[], jour: string): DelegationValidation[] {
  const actives = liste.filter(g => ['en_cours', 'a_venir'].includes(etatDelegation(g, jour))).sort((a, b) => a.du.localeCompare(b.du));
  const passees = liste.filter(g => !actives.includes(g)).sort((a, b) => b.au.localeCompare(a.au) || b.id - a.id).slice(0, PASSEES_MAX);
  return [...actives, ...passees];
}

/** Une délégation : qui, quand, quoi, état ; « Révoquer » si elle n'est pas finie et que la personne le peut. */
function LigneDelegation({ g, autre, revocable }: { g: DelegationValidation; autre: string; revocable: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const etat = etatDelegation(g, d.ti);
  const actif = etat === 'en_cours' || etat === 'a_venir';
  return (
    <div className="list-row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{autre}</div>
        <div className="text-muted sub">
          Du {fmtIso(g.du)} au {fmtIso(g.au)} · {perimetreTexte(perimetreEffectif(d.ds.settings, g)) || 'aucun périmètre en vigueur'}
          {g.revoqueeLe ? ` · révoquée le ${fmtIso(g.revoqueeLe.slice(0, 10))}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 'none' }}>
        <Tag cls={ETAT_DELEGATION[etat].cls}>{ETAT_DELEGATION[etat].label}</Tag>
        {actif && revocable && (
          <Btn small onClick={() => openDialog({ type: 'confirmer', c: revocationDelegation(g, d.personName(g.managerId), d.personName(g.suppleantId), etat === 'en_cours') })}>
            Révoquer
          </Btn>
        )}
      </div>
    </div>
  );
}

/**
 * Délégations données par un manager : le manager lui-même (Mon espace) ou le service RH (Équipes & managers) délèguent et
 * révoquent ; la lecture seule consulte. `cadre` : panneau autonome (Mon espace) ou bloc dans un panneau (équipe).
 */
export function DelegationsManager({ managerId, cadre = true }: { managerId: number; cadre?: boolean }) {
  const d = useDomain();
  const { openDialog } = useStore();
  const { rh, me, espaceRh } = useRole();
  const soi = !espaceRh && me === managerId;
  const peut = rh || soi;
  const liste = aAfficher((d.ds.delegations ?? []).filter(g => g.managerId === managerId), d.ti);
  const nom = d.personName(managerId);
  const bouton = peut && (
    <Btn small variant="secondary" onClick={() => openDialog({ type: 'delegation', managerId })}>
      {soi ? 'Déléguer mes validations' : 'Déléguer les validations'}
    </Btn>
  );
  const contenu = <>
    {liste.length
      ? <div className="list">{liste.map(g => <LigneDelegation key={g.id} g={g} autre={`Suppléant : ${d.personName(g.suppleantId)}`} revocable={peut} />)}</div>
      : <Empty pad="sm">{soi ? 'Aucune délégation : pendant vos absences, vos validations restent en attente de votre retour, ou du service RH.' : `Aucune délégation des validations de ${nom}.`}</Empty>}
    <Fine>
      Pendant une absence, {soi ? 'vous pouvez confier vos' : 'le manager peut confier ses'} validations (congés, feuilles de temps) à un suppléant, pour une période
      datée : il en reçoit les demandes et décide « par délégation ». Le responsable du manager est proposé d’abord.
    </Fine>
  </>;
  if (!cadre) {
    return (
      <div className="col-stack" style={{ gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Délégation des validations de {nom}</h3>
          {bouton}
        </div>
        {contenu}
      </div>
    );
  }
  return <Panel title="Délégation de mes validations" aside={bouton || undefined} style={{ gap: 'var(--space-2)' }}>{contenu}</Panel>;
}

/** Délégations reçues par la personne connectée (suppléant) : qui il remplace, quand, pour quoi. Rien s'il n'en a pas. */
export function DelegationsRecues() {
  const d = useDomain();
  const { me } = useRole();
  const liste = aAfficher((d.ds.delegations ?? []).filter(g => g.suppleantId === me), d.ti).filter(g => ['en_cours', 'a_venir'].includes(etatDelegation(g, d.ti)));
  if (!liste.length) return null;
  return (
    <Panel highlight title="Suppléance" aside="validations reçues par délégation" style={{ gap: 'var(--space-2)' }}>
      <div className="list">{liste.map(g => <LigneDelegation key={g.id} g={g} autre={`Vous remplacez ${d.personName(g.managerId)}`} revocable={false} />)}</div>
      <Fine>Pendant la délégation, l’espace Manager vous est ouvert (choix de l’espace dans le menu) : les demandes de l’équipe y attendent votre décision.</Fine>
    </Panel>
  );
}

/** Mon espace : délégations reçues, et celles du manager connecté s'il encadre une équipe. */
export function DelegationsPortail() {
  const d = useDomain();
  const { me } = useRole();
  if (!me) return null;
  return <>
    <DelegationsRecues />
    {d.teamsOf(me).length > 0 && <DelegationsManager managerId={me} />}
  </>;
}

/**
 * Mon espace : « · en son absence, Sophie Lemaire jusqu'au 16/10/2026 » quand le valideur du salarié a délégué ses congés
 * aujourd'hui (pour le suppléant lui-même, le responsable du manager ou le service RH) ; vide sinon.
 */
export function suppleanceTexte(d: Domain, e: Pick<Employe, 'id' | 'equipe'>): string {
  const v = valideursDe(d.ds, e, d.ti, 'absences').find(x => x.delegation);
  return v?.delegation ? ` · en son absence, ${d.mgrName(v.id)} jusqu’au ${fmtIso(v.delegation.au)}` : '';
}
