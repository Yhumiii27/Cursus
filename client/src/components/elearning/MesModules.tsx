// lot 12 — C4 (organismes de formation et e-learning) : « Mes modules en ligne » du portail collaborateur. Ses
// inscriptions (le serveur n'envoie que les siennes) : module, lien d'accès ouvert dans un nouvel onglet (rel=noopener,
// jamais dans un cadre), échéance, avancement connu, et « J'ai terminé » (fin déclarée, en ligne, validée ensuite par le
// service RH). Jamais de pourcentage déclaré par le salarié, ni de temps de connexion.
import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { fmtIso, plural } from '../../../../shared/format.ts';
import { etatInscription, finAcces, inscriptionOuverte, LANGUES_MODULE, STATUT_INSCRIPTION_LABEL, urlModuleValide } from '../../../../shared/rules/elearning.ts';
import { useAgir } from '../../state/actions.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Fine, Panel, Tag } from '../ui.tsx';
import { CLS_INSCRIPTION } from '../organismes/etat.ts';

/** Ses modules : ouverts d'abord (échéance la plus proche), puis les terminés de l'année ; rien s'il n'en a aucun. */
export function MesModules({ empId }: { empId: number }) {
  const d = useDomain();
  const { run } = useStore();
  const { occupe, agir } = useAgir();
  const annee = d.ti.slice(0, 4);
  const miennes = (d.ds.inscriptionsElearning ?? []).filter(i => i.empId === empId && !i.annuleLe
    && (inscriptionOuverte(i) || (i.statut === 'termine' && (i.termineLe ?? '').startsWith(annee))))
    .sort((a, b) => Number(inscriptionOuverte(b)) - Number(inscriptionOuverte(a)) || (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999'));
  if (!miennes.length) return null;
  const ouvertes = miennes.filter(inscriptionOuverte).length;
  return (
    <Panel title="Mes modules en ligne" aside={plural(ouvertes, 'module à suivre', 'modules à suivre')} style={{ gap: 'var(--space-2)' }}>
      {miennes.map(i => {
        const m = (d.ds.modulesElearning ?? []).find(x => x.id === i.moduleId);
        if (!m) return null;
        const etat = etatInscription(i, m, d.ti);
        const fin = finAcces(i, m);
        const ouverte = inscriptionOuverte(i);
        return (
          <div key={i.id} className="list-row stack" style={{ gap: 'var(--space-1)', padding: 'var(--space-2) 0' }}>
            <div className="item-head">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{m.intitule}</div>
                <div className="text-muted sub">
                  {[m.dureeHeures != null ? `${String(m.dureeHeures).replace('.', ',')} h` : '', LANGUES_MODULE[m.langue] ?? m.langue,
                    i.echeance ? `à terminer avant le ${fmtIso(i.echeance)}` : '', fin && ouverte ? `accès jusqu’au ${fmtIso(fin)}` : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Tag cls={i.declareLe && ouverte ? 'tag-outline' : CLS_INSCRIPTION[etat]} style={{ flex: 'none' }}>
                {i.declareLe && ouverte ? 'Fin déclarée' : STATUT_INSCRIPTION_LABEL[etat]}
              </Tag>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Lien d'accès : ouvert hors de Cursus (nouvel onglet, sans transmettre la page d'origine), jamais dans un cadre. */}
              {ouverte && etat !== 'expire' && urlModuleValide(m.url) && (
                <a className="btn btn-secondary btn-sm" href={m.url} target="_blank" rel="noopener noreferrer">
                  <ArrowSquareOutIcon size={14} /> Ouvrir le module
                </a>
              )}
              {ouverte && !i.declareLe && <Btn small disabled={occupe} onClick={agir(() => run('elearning.declarer', { id: i.id }))}>J’ai terminé</Btn>}
              <span className="text-muted sub">
                {i.statut === 'termine' ? `Terminé le ${i.termineLe ? fmtIso(i.termineLe) : '—'}` : i.declareLe ? `Déclaré le ${fmtIso(i.declareLe)} : le service RH valide la fin`
                  : i.avancement != null ? `Avancement connu : ${i.avancement} %` : etat === 'expire' ? 'Accès expiré : voyez le service RH' : ''}
              </span>
            </div>
          </div>
        );
      })}
      <Fine>Le module s’ouvre chez l’organisme. Cursus ne garde que le statut, l’avancement transmis par l’organisme et la fin, jamais votre temps de connexion.</Fine>
    </Panel>
  );
}
