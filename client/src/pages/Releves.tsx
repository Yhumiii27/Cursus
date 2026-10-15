// Temps de travail → relevés d'heures des intérimaires (service RH) : pour la semaine affichée, le relevé de chaque
// agence d'intérim (heures des feuilles validées, feuilles en attente), son envoi automatique ou manuel, ses renvois.
// Le relevé part tout seul quand toutes les feuilles de la semaine sont validées, jusqu'à cinq semaines après ; un
// relevé envoyé incomplet est complété de même (server/src/releves.ts).
import { useState } from 'react';
import { DownloadSimpleIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { ENVOI_CLS, ENVOI_LABEL } from '../../../shared/constants.ts';
import { isoWeek, mondayOf } from '../../../shared/dates.ts';
import { fmt, key, plural } from '../../../shared/format.ts';
import { adresseAgence, agencesInterim } from '../../../shared/rules/messagerie.ts';
import { heuresTexte, releveAgence, releveCsv, semainesAutomatiques } from '../../../shared/rules/releves.ts';
import type { ISODate } from '../../../shared/types.ts';
import { Btn, Fine, Panel, Tag, Two } from '../components/ui.tsx';
import { downloadCsv } from '../print.ts';
import { useDomain } from '../state/derived.ts';
import { envoiReleve } from '../state/confirmations.ts';
import { useStore } from '../state/store.tsx';

const quand = (at: string) => {
  const x = new Date(at);
  return `${fmt(x)} à ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
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
    notify(`Relevé exporté — ${plural(x.r.lignes.length, 'intérimaire', 'intérimaires')}`);
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
    <Panel title="Relevés d’heures des intérimaires" aside={`Semaine ${isoWeek(wk)}`}>
      <Fine>
        Chaque semaine, le relevé des heures validées des intérimaires part par e-mail à leur agence (fichier CSV joint), dès que toutes leurs feuilles
        de la semaine sont validées, même avec retard (jusqu’à cinq semaines). S’il manque une feuille, le relevé peut être envoyé sans elle : le relevé
        complet suit à sa validation. Un relevé se renvoie à tout moment.
      </Fine>
      {agences.length === 0 ? <Fine>Aucun intérimaire en mission cette semaine.</Fine> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Agence</th><th>Intérimaires</th><th>Heures validées</th><th>Relevé</th><th></th></tr></thead>
            <tbody>
              {agences.map(x => {
                const dernier = x.envois[0];
                const total = x.r.lignes.length + x.r.enAttente.length;
                return (
                  <tr key={x.agence}>
                    <td><Two main={x.agence} sub={x.adresse ?? 'Adresse à renseigner (Paramètres → Messagerie)'} /></td>
                    <td><Two main={`${x.r.lignes.length} / ${total} feuille${total > 1 ? 's' : ''} validée${total > 1 ? 's' : ''}`}
                      sub={x.r.enAttente.length ? `en attente : ${x.r.enAttente.map(e => e.nom).join(', ')}` : x.r.lignes.map(l => l.nom).join(', ')} /></td>
                    <td className="tnum">{heuresTexte(x.r.heures)} h</td>
                    <td>
                      {dernier ? <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <span>{dernier.enAttente ? 'Transmis (incomplet)' : 'Transmis'}</span>
                          {dernier.envoi && <Tag cls={ENVOI_CLS[dernier.envoi]}>{ENVOI_LABEL[dernier.envoi]}</Tag>}
                        </div>
                        <div className="text-muted sub">
                          le {quand(dernier.creation)} · {dernier.par === 'Cursus' ? 'envoi automatique' : `par ${dernier.par}`}
                          {x.envois.length > 1 ? ` · ${plural(x.envois.length, 'envoi', 'envois')}` : ''}
                          {dernier.enAttente ? ` · ${plural(dernier.enAttente, 'feuille manquait', 'feuilles manquaient')} : relevé complet ${x.automatique ? 'envoyé automatiquement après la validation' : 'à renvoyer après la validation'}` : ''}
                        </div>
                      </> : <span className="text-muted sub">
                        {!x.adresse ? 'Non transmis : adresse de l’agence manquante' : x.r.enAttente.length ? 'Non transmis : feuilles à valider'
                          : future ? 'Semaine à venir' : x.automatique ? 'Envoi automatique imminent' : wk === mondayOf(data.today) ? 'Envoi automatique après le vendredi' : 'Non transmis'}
                      </span>}
                    </td>
                    <td className="right">
                      <div className="actions-end">
                        <Btn small icon={<DownloadSimpleIcon size={14} />} disabled={!x.r.lignes.length} onClick={() => telecharger(x)}>CSV</Btn>
                        <Btn small variant="secondary" icon={<PaperPlaneTiltIcon size={14} />} disabled={!x.adresse || !x.r.lignes.length || future || busy === x.agence}
                          onClick={() => envoyer(x)}>{x.envois.length ? 'Renvoyer' : 'Envoyer'}</Btn>
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
