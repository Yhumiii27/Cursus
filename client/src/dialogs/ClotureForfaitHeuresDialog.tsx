// Clôture du forfait annuel en heures (lot 12, chantier C1, `forfaitHeures.cloturer`, administrateur RH) : une ligne par
// plage terminée sans ligne confirmée (fin de la période de référence, sortie, avenant qui fait quitter le forfait), cochée
// d'office quand rien ne la bloque. Pour chacune : cible au prorata, absences déduites (total, sans nature), cible nette,
// réalisé, heures dues par rubrique (HFA25 et HFA50, ou HCA10 et HCA25 pour un temps partiel annualisé) ou heures non
// réalisées (information, jamais retenues), alertes et blocages (shared/rules/forfait-heures.ts). Une ligne bloquée ne se
// coche pas (le serveur refuserait toute la clôture) ; la sienne propre est clôturée par un autre administrateur RH. Le
// serveur recalcule chaque ligne : l'écran n'est qu'un aperçu.
import { useMemo, useState } from 'react';
import { equipeLabel, fH, plural } from '../../../shared/format.ts';
import { plagesAClore, type PlageAClore } from '../../../shared/rules/forfait-heures.ts';
import { Bloquant, CancelButton, Dialog, SubmitButton, useVerification } from '../components/Dialog.tsx';
import { Empty, Fine, NoteAccent, Tag } from '../components/ui.tsx';
import { heuresDuesTexte, periodeTexte, plageTexte } from '../components/temps/forfait-heures-vue.ts';
import { useDomain, useRole } from '../state/derived.ts';
import { useStore } from '../state/store.tsx';

const cle = (p: PlageAClore) => `${p.e.id}|${p.calc.debut}`;

/** Chiffre de la ligne : libellé atténué au-dessus de la valeur. */
function Chiffre({ label, children }: { label: string; children: string }) {
  return (
    <div style={{ minWidth: 104 }}>
      <div className="text-muted sub">{label}</div>
      <div className="tnum" style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

/** `periode` : début de la période de référence dont on clôture les plages ; null : toutes les plages à clôturer. */
export function ClotureForfaitHeuresDialog({ periode }: { periode: string | null }) {
  const d = useDomain();
  const { run, closeDialog } = useStore();
  const { soi } = useRole();
  const plages = useMemo(() => plagesAClore(d).filter(p => !periode || p.reference.debut === periode), [d, periode]);
  const clotuables = plages.filter(p => !p.calc.blocages.length && p.e.id !== soi);
  // Cases décochées ; une ligne apparue depuis l'ouverture (données relues) est cochée d'office.
  const [decochees, setDecochees] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const v = useVerification();
  const cochees = clotuables.filter(p => !decochees.has(cle(p)));
  const basculer = (p: PlageAClore) => setDecochees(s => { const n = new Set(s); if (n.has(cle(p))) n.delete(cle(p)); else n.add(cle(p)); return n; });
  const rien = !cochees.length ? 'Cochez au moins une ligne à clôturer.' : null;
  const titre = `Clôture du forfait annuel en heures${periode && plages[0] ? ` · ${periodeTexte(plages[0].reference)}` : ''}`;

  const confirm = async () => {
    if (busy || !v.verifier(rien)) return;
    setBusy(true);
    const r = await run('forfaitHeures.cloturer', { lignes: cochees.map(p => ({ empId: p.e.id, debut: p.calc.debut })) });
    setBusy(false);
    if (r.ok) closeDialog();
  };

  if (!plages.length) {
    return (
      <Dialog title={titre} actions={<CancelButton label="Fermer" />}>
        <p className="text-muted" style={{ margin: 0 }}>Aucune plage à clôturer : chacune est confirmée, ou la période n’est pas terminée.</p>
      </Dialog>
    );
  }

  return (
    <Dialog title={titre} width={760} tall onSubmit={confirm} actions={<>
      <CancelButton />
      <SubmitButton busy={busy}>Clôturer {plural(cochees.length, 'ligne', 'lignes')}</SubmitButton>
    </>}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Pour chaque salarié, Cursus compare les heures réalisées (feuilles validées décomptées au forfait) à la cible nette : le forfait au prorata de la
        plage, moins les absences déduites. Les heures au-delà partent à la paie ; les heures non réalisées sont affichées, jamais retenues. Chaque ligne est
        recalculée et photographiée à la confirmation.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {plages.map(p => {
          const c = p.calc, k = cle(p);
          const bloquee = c.blocages.length > 0, mienne = p.e.id === soi;
          const coche = !bloquee && !mienne && !decochees.has(k);
          return (
            <div key={k} className="boxed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{p.e.nom}</div>
                  <div className="text-muted sub">
                    {equipeLabel(p.e)} · {plageTexte(c)} · forfait de {fH(c.forfait)}{c.partiel ? ' (temps partiel annualisé)' : ''}
                    {p.ligne?.statut === 'proposee' && ` · ${p.ligne.version > 1 ? `version ${p.ligne.version}, seul l’écart avec la version transmise partira (lot correctif)` : 'rouverte, à confirmer'}`}
                  </div>
                </div>
                {bloquee ? <Tag cls="tag-accent">Bloquée</Tag>
                  : mienne ? <span className="text-muted sub">Votre forfait : clôture par un autre administrateur RH</span>
                  : (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={coche} onChange={() => basculer(p)} style={{ accentColor: 'var(--color-accent)' }} />
                      Clôturer
                    </label>
                  )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3) var(--space-6)' }}>
                <Chiffre label="Cible au prorata">{fH(c.cible)}</Chiffre>
                <Chiffre label="Absences déduites">{c.absences ? `− ${fH(c.absences)}` : '—'}</Chiffre>
                <Chiffre label="Cible nette">{fH(c.cibleNette)}</Chiffre>
                <Chiffre label="Réalisé">{fH(c.realise)}</Chiffre>
                <Chiffre label="Écart">{`${c.ecart > 0 ? '+' : ''}${fH(c.ecart)}`}</Chiffre>
              </div>
              <div style={{ fontSize: 13 }}>
                {heuresDuesTexte(c)}
                {!c.partiel && c.hfa25 + c.hfa50 > 0 && <span className="text-muted"> · 25 % jusqu’à {fH(c.seuil25)} ({plural(c.semaines, 'semaine travaillée', 'semaines travaillées')})</span>}
              </div>
              {c.alertes.map(a => <NoteAccent key={a}>{a}</NoteAccent>)}
              {c.blocages.length > 0 && (
                <ul className="text-muted sub" style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                  {c.blocages.slice(0, 5).map(b => <li key={b}>{b}</li>)}
                  {c.blocages.length > 5 && <li>… et {plural(c.blocages.length - 5, 'autre blocage', 'autres blocages')}</li>}
                </ul>
              )}
            </div>
          );
        })}
        {!clotuables.length && <Empty pad="sm">Aucune ligne clôturable pour le moment : levez d’abord les blocages.</Empty>}
      </div>
      {rien && v.tente && <Bloquant>{rien}</Bloquant>}
      <Fine>
        À la validation : {plural(cochees.length, 'ligne confirmée', 'lignes confirmées')}, heures transmises par le prochain lot de paie de leur période (rubriques HFA et HCA
        désactivées tant que la paie n’a pas donné leurs codes : « à saisir dans Sage ») ; une plage close par la sortie part avec le solde de sortie.
        Une ligne confirmée n’est jamais refaite : pour la corriger, rouvrez-la. Tracé au journal sans aucune heure.
      </Fine>
    </Dialog>
  );
}
