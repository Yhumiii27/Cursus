// Temps de travail → relevés d'heures des intérimaires (service RH) : pour la semaine affichée, le relevé de chaque
// agence d'intérim (heures des feuilles validées, feuilles en attente), son envoi automatique ou manuel, ses renvois.
// Le relevé part tout seul quand toutes les feuilles de la semaine sont validées, jusqu'à cinq semaines après ; un
// relevé envoyé incomplet est complété de même (server/src/releves.ts).
import { useState } from 'react';
import { DownloadSimpleIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { ENVOI_CLS, ENVOI_LABEL } from '../../../shared/constants.ts';
import { isoWeek, mondayOf } from '../../../shared/dates.ts';
import { fmt, key } from '../../../shared/format.ts';
import { adresseAgence, agencesInterim } from '../../../shared/rules/messagerie.ts';
import { heuresTexte, releveAgence, releveCsv, semainesAutomatiques } from '../../../shared/rules/releves.ts';
import type { ISODate } from '../../../shared/types.ts';
import { Btn, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { downloadCsv } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { envoiReleve } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';
import { t, tn } from '../i18n/langue.ts';

const quand = (at: string) => {
  const x = new Date(at);
  return `${fmt(x)}${t(' at ')}${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function RelevesPanel({ wk }: { wk: ISODate }) {
  const d = useDomain();
  const data = d.ds;
  const { run, notify, openDialog } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const future = wk > mondayOf(data.today);
  const agences = agencesInterim(data.employes).map(agence => ({
    agence, r: releveAgence(d, agence, wk), adresse: adresseAgence(data.messagerie, agence),
    envois: data.releves.filter(x => key(x.agence) === key(agence) && x.semaine === wk).sort((a, b) => b.id - a.id),
    // Semaine couverte par l'envoi automatique (cinq semaines révolues, pas avant l'adresse de l'agence).
    automatique: semainesAutomatiques(data.today, data.messagerie?.agences.find(a => key(a.nom) === key(agence))?.depuis).includes(wk),
  })).filter(x => x.r.lignes.length || x.r.enAttente.length || x.envois.length);
  if (!agencesInterim(data.employes).length) return null;

  const telecharger = (x: (typeof agences)[number]) => {
    const csv = releveCsv(x.r);
    downloadCsv(csv.fichier, csv.head, csv.rows);
    notify(`${t('Statement exported — ')}${tn(x.r.lignes.length, 'temporary worker', 'temporary workers')}`);
  };
  // Renvoi, ou relevé sans les feuilles pas encore validées : confirmation (state/confirmations.ts) ; sinon, aussitôt.
  const envoyer = async (x: (typeof agences)[number]) => {
    if (x.envois.length || x.r.enAttente.length) {
      openDialog({ type: 'confirmer', c: envoiReleve(x.agence, x.adresse ?? '', wk, isoWeek(wk), { renvoi: x.envois.length > 0, enAttente: x.r.enAttente.map(e => e.nom) }) });
      return;
    }
    setBusy(x.agence);
    await run('releve.envoyer', { agence: x.agence, semaine: wk });
    setBusy(null);
  };

  return (
    <Panel title={t('Hours statements of the temporary workers')} aside={`${t('Week ')}${isoWeek(wk)}`}>
      <Fine>
        {t('Each week, the statement of the approved hours of the temporary workers is e-mailed to their agency (CSV file attached), as soon as all their timesheets of the week are approved, even late (up to five weeks). If a timesheet is missing, the statement can be sent without it: the complete statement follows at its approval. A statement can be sent again at any time.')}
      </Fine>
      {agences.length === 0 ? <Fine>{t('No temporary worker on assignment this week.')}</Fine> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>{t('Agency')}</th><th>{t('Temporary workers')}</th><th>{t('Approved hours')}</th><th>{t('Statement')}</th><th></th></tr></thead>
            <tbody>
              {agences.map(x => {
                const dernier = x.envois[0];
                const total = x.r.lignes.length + x.r.enAttente.length;
                return (
                  <tr key={x.agence}>
                    <td><Two main={x.agence} sub={x.adresse ?? t('Address to enter (Settings → Messaging)')} /></td>
                    <td><Two main={`${x.r.lignes.length} / ${tn(total, 'timesheet approved', 'timesheets approved')}`}
                      sub={x.r.enAttente.length ? `${t('pending: ')}${x.r.enAttente.map(e => e.nom).join(', ')}` : x.r.lignes.map(l => l.nom).join(', ')} /></td>
                    <td className="tnum">{heuresTexte(x.r.heures)} h</td>
                    <td>
                      {dernier ? <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <span>{t(dernier.enAttente ? 'Sent (incomplete)' : 'Sent#statement')}</span>
                          {dernier.envoi && <Tag cls={ENVOI_CLS[dernier.envoi]}>{ENVOI_LABEL[dernier.envoi]}</Tag>}
                        </div>
                        <div className="text-muted sub">
                          {t('on #date')}{quand(dernier.creation)} · {dernier.par === 'Cursus' ? t('automatic sending') : `${t('by ')}${dernier.par}`}
                          {x.envois.length > 1 ? ` · ${tn(x.envois.length, 'sending', 'sendings')}` : ''}
                          {dernier.enAttente ? ` · ${tn(dernier.enAttente, 'timesheet was missing', 'timesheets were missing')}${t(x.automatique ? ': complete statement sent automatically after the approval' : ': complete statement to send again after the approval')}` : ''}
                        </div>
                      </> : <span className="text-muted sub">
                        {t(!x.adresse ? 'Not sent: agency’s address missing' : x.r.enAttente.length ? 'Not sent: timesheets to approve'
                          : future ? 'Coming week' : x.automatique ? 'Automatic sending imminent' : wk === mondayOf(data.today) ? 'Automatic sending after Friday' : 'Not sent')}
                      </span>}
                    </td>
                    <td className="right">
                      <div className="actions-end">
                        <Btn small icon={<DownloadSimpleIcon size={14} />} disabled={!x.r.lignes.length} onClick={() => telecharger(x)}>CSV</Btn>
                        <Btn small variant="secondary" icon={<PaperPlaneTiltIcon size={14} />} disabled={!x.adresse || !x.r.lignes.length || future || busy === x.agence}
                          onClick={() => envoyer(x)}>{t(x.envois.length ? 'Send again' : 'Send')}</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
