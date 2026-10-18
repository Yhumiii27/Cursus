// Liste imprimable des postes à risques particuliers pour la santé ou la sécurité (art. L4154-2, t061) : établie par
// l'employeur après avis du médecin du travail et du CSE, tenue à la disposition de l'inspection du travail. Écran
// Référentiels, onglet Postes ; règles : shared/rules/formation-renforcee.ts. Aucun nom de salarié : des postes, leurs
// exigences et le nombre de titulaires en CDD, intérim ou alternance.
import type { Domain } from '../../shared/domain.ts';
import { titulaires } from '../../shared/rules/exigences.ts';
import { contratRenforcee, formationRenforcee, postesARisques } from '../../shared/rules/formation-renforcee.ts';
import { printDocument } from './print.ts';

/** Imprime la liste ; faux si rien n'a pu s'ouvrir. */
export function imprimerPostesARisques(d: Domain): boolean {
  const postes = postesARisques(d.ds.referentiels.postes), f = formationRenforcee(d.ds);
  const noms = (ids: string[], nom: (id: string) => string | undefined) => ids.map(id => nom(id) ?? id).join(', ') || '—';
  return printDocument('Liste des postes à risques particuliers', `Article L4154-2 du code du travail · ${postes.length} poste${postes.length > 1 ? 's' : ''}`, [
    {
      title: 'Postes',
      ...(postes.length ? {
        table: {
          head: ['Poste', 'Suivi individuel renforcé', 'Exposé à des risques particuliers', 'Formations exigées', 'Habilitations exigées', 'Titulaires en CDD, intérim ou alternance'],
          rows: postes.map(p => [
            p.nom, p.sir ? 'Oui' : 'Non', p.expose ? 'Oui' : 'Non',
            noms(p.formations, id => d.fm(id)?.nom), noms(p.habilitations, id => d.hm(id)?.nom),
            String(titulaires(d.ds, p.id).filter(e => contratRenforcee(e.typeContrat)).length),
          ]),
        },
      } : { text: 'Aucun poste n’est inscrit sur la liste (Référentiels → Postes, case « Liste des postes à risques particuliers »).' }),
    },
    {
      title: 'Formation renforcée à la sécurité',
      text: f
        ? `${f.nom} (${f.court}) : exigée des salariés en CDD, des intérimaires et des alternants affectés à l’un de ces postes, suivie depuis leur entrée (art. L4154-2 et L4154-3).`
        : 'Formation renforcée non désignée (Paramètres → Postes à risques particuliers).',
    },
    {
      title: 'Établissement de la liste',
      text: 'Liste établie par l’employeur après avis du médecin du travail et du comité social et économique, tenue à la disposition de l’inspection du travail (art. L4154-2). Avis du médecin du travail du : ............ · Avis du CSE du : ............',
    },
  ]);
}
