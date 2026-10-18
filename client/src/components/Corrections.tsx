// Corrections d'une saisie erronée sur la fiche du collaborateur (t119, shared/rules/corrections.ts) : « Corriger » et
// « Supprimer » une certification (service RH et référent HSE ; suppression : administrateur RH), certifications
// supprimées (historique, service RH seul), demandes au service RH avec « Rouvrir » (service RH, référent HSE) et
// « Retirer » (le manager pour celle qu'il a faite, tant qu'elle attend).
import { REQ_CLS, REQ_LABEL } from '../../../shared/constants.ts';
import type { CertInfo, EmpX } from '../../../shared/domain.ts';
import { parse } from '../../../shared/dates.ts';
import { fmt, fmtShort } from '../../../shared/format.ts';
import { auteurDemande, certsApres, demandeRetirable, demandeRouvrable, effetsReouverture, inscriptionsARendre } from '../../../shared/rules/corrections.ts';
import { sessionActive } from '../../../shared/domain.ts';
import { sessionDu } from '../../../shared/rules/plage-session.ts';
import { reouvertureDemande, retraitDemande, suppressionCertification } from '../state/confirmations-corrections.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';
import { reqKind, reqLabel } from '../pages/Dashboard.tsx';
import { SectionLabel, Tag } from './ui.tsx';

/** Boutons de correction d'une certification du dossier (en vigueur ou remplacée). */
export function ActionsCertification({ e, c }: { e: EmpX; c: CertInfo }) {
  const { formations, admin } = useRole();
  const { openDialog } = useStore();
  const d = useDomain();
  if (!formations) return null;
  // Certification en vigueur supprimée : la plus récente des remplacées de la même formation reprend sa place.
  const precedente = !c.remplacee ? e.anciennes.find(x => x.f === c.f)?.obtenue ?? null : null;
  const supprimer = () => {
    // Inscriptions en formation initiale que la certification avait closes : rendues, ou à refaire (même règle que le serveur).
    const emp = d.emp(e.id)!, brute = emp.certs.find(x => x.id === c.id);
    const rendues = brute ? inscriptionsARendre(d, emp, brute, certsApres(emp.certs, c.id)).map(r => ({ session: sessionDu(r.s), refus: r.refus, ouverte: sessionActive(r.s) })) : [];
    openDialog({
      type: 'confirmer',
      c: suppressionCertification(c, e.nom, `${c.fm.court} du ${fmt(c.obt)}`, { precedente, session: c.session ? sessionDu(c.session) : null, rendues }),
    });
  };
  return (
    <div className="actions-end">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDialog({ type: 'cert', empId: e.id, certId: c.id })}>Corriger</button>
      {admin && <button type="button" className="btn btn-ghost btn-sm" onClick={supprimer}>Supprimer</button>}
    </div>
  );
}

/** Certifications supprimées (saisie erronée) : date, auteur et motif ; transmises au seul service RH. */
export function CertsAnnulees({ e }: { e: EmpX }) {
  const d = useDomain();
  const liste = e.certsAnnulees ?? [];
  if (!liste.length) return null;
  return (
    <div className="list" style={{ marginTop: 'var(--space-2)' }}>
      {liste.map(c => (
        <div key={c.id} className="list-row past">
          <div className="grow">
            <div style={{ fontSize: 13 }}>{d.fm(c.f)?.nom ?? c.f} — obtenue le {fmt(parse(c.obtenue))}</div>
            <div className="sub">Supprimée le {c.annuleLe ? fmt(parse(c.annuleLe)) : '—'}{c.annulePar ? ` par ${c.annulePar}` : ''}{c.annuleMotif ? ` — ${c.annuleMotif}` : ''}</div>
          </div>
          <Tag cls="tag-outline" style={{ flex: 'none' }}>Supprimée</Tag>
        </div>
      ))}
    </div>
  );
}

/**
 * Demandes de formation et d'habilitation du collaborateur : le service RH et le référent HSE les rouvrent (acceptée ou
 * refusée par erreur) ; le manager retire celle qu'il a faite, tant qu'elle attend. Les demandes en attente se décident
 * depuis l'accueil.
 */
export function DemandesFiche({ e, membre }: { e: EmpX; membre: boolean }) {
  const d = useDomain();
  const { formations, me } = useRole();
  const { openDialog } = useStore();
  if (!formations && !membre) return null;
  const demandes = d.ds.demandesCollab.filter(r => r.empId === e.id && r.type !== 'document').sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  if (!demandes.length) return null;
  return <>
    <SectionLabel>Demandes au service RH</SectionLabel>
    <div className="list" style={{ marginTop: 'calc(-1 * var(--space-3))' }}>
      {demandes.map(r => {
        const objet = reqLabel(r, id => d.fm(id)?.nom ?? id, id => d.hm(id)?.nom ?? id);
        const rouvrir = formations && demandeRouvrable(r);
        const retirer = membre && demandeRetirable(r) && auteurDemande(r) === me;
        return (
          <div key={r.id} className="list-row stack">
            <div className="item-head">
              <div>
                <div style={{ fontSize: 14 }}>{objet}</div>
                <div className="text-muted sub">
                  {reqKind(r)} · {r.parId ? `par ${d.personName(r.parId)} (manager)` : 'par le collaborateur'} le {fmtShort(parse(r.date))}
                  {r.rouverteLe ? ` · rouverte le ${fmtShort(parse(r.rouverteLe))}${r.rouvertePar ? ` par ${r.rouvertePar}` : ''}` : ''}
                </div>
              </div>
              <Tag cls={REQ_CLS[r.statut]} style={{ flex: 'none' }}>{REQ_LABEL[r.statut]}</Tag>
            </div>
            {(rouvrir || retirer) && (
              <div className="actions-end">
                {rouvrir && <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => openDialog({ type: 'confirmer', c: reouvertureDemande(r, e.nom, objet, effetsReouverture(d, r, d.emp(e.id)!)) })}>Rouvrir</button>}
                {retirer && <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => openDialog({ type: 'confirmer', c: retraitDemande(r, objet, e.nom) })}>Retirer la demande</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </>;
}
