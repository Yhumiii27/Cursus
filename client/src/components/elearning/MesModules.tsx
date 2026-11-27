// lot 12 — C4 (organismes de formation et e-learning) : « Mes modules en ligne » du portail collaborateur. Ses
// inscriptions (le serveur n'envoie que les siennes) : module, lien d'accès ouvert dans un nouvel onglet (rel=noopener,
// jamais dans un cadre), échéance, avancement connu, et « J'ai terminé » (fin déclarée, en ligne, validée ensuite par le
// service RH). Jamais de pourcentage déclaré par le salarié, ni de temps de connexion.
import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { fmtIso } from '../../../../shared/format.ts';
import { etatInscription, finAcces, inscriptionOuverte, LANGUES_MODULE, STATUT_INSCRIPTION_LABEL, urlModuleValide } from '../../../../shared/rules/elearning.ts';
import { useAgir } from '../../state/actions.ts';
import { useDomain } from '../../state/derived.ts';
import { useStore } from '../../state/store.tsx';
import { Btn, Fine, Panel, Tag } from '../ui.tsx';
import { CLS_INSCRIPTION } from '../organismes/etat.ts';
import { t, tn } from '../../i18n/langue.ts';

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
    <Panel title={t('My online modules')} aside={tn(ouvertes, 'module to follow', 'modules to follow')} style={{ gap: 'var(--space-2)' }}>
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
                    i.echeance ? `${t('to complete before ')}${fmtIso(i.echeance)}` : '', fin && ouverte ? `${t('access until ')}${fmtIso(fin)}` : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Tag cls={i.declareLe && ouverte ? 'tag-outline' : CLS_INSCRIPTION[etat]} style={{ flex: 'none' }}>
                {i.declareLe && ouverte ? t('End declared') : STATUT_INSCRIPTION_LABEL[etat]}
              </Tag>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Lien d'accès : ouvert hors de Cursus (nouvel onglet, sans transmettre la page d'origine), jamais dans un cadre. */}
              {ouverte && etat !== 'expire' && urlModuleValide(m.url) && (
                <a className="btn btn-secondary btn-sm" href={m.url} target="_blank" rel="noopener noreferrer">
                  <ArrowSquareOutIcon size={14} /> {t('Open the module')}
                </a>
              )}
              {ouverte && !i.declareLe && <Btn small disabled={occupe} onClick={agir(() => run('elearning.declarer', { id: i.id }))}>{t('I have finished')}</Btn>}
              <span className="text-muted sub">
                {i.statut === 'termine' ? `${t('Completed on #masc')}${i.termineLe ? fmtIso(i.termineLe) : '—'}` : i.declareLe ? `${t('Declared on #masc')}${fmtIso(i.declareLe)}${t(': HR approves the end')}`
                  : i.avancement != null ? `${t('Known progress: ')}${i.avancement} %` : etat === 'expire' ? t('Access expired: see HR') : ''}
              </span>
            </div>
          </div>
        );
      })}
      <Fine>{t('The module opens at the provider. Cursus only keeps the status, the progress transmitted by the provider and the end, never your connection time.')}</Fine>
    </Panel>
  );
}
