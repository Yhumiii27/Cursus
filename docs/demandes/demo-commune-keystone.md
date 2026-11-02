# Keystone — démonstration commune : matricules du référentiel de Cursus

**Statut** : proposition à valider par le propriétaire (2 novembre 2026), puis à porter dans le `REQUESTS.md` de Keystone.
Rien n'est écrit dans le dépôt de Keystone depuis Cursus. En attendant, Cursus porte seul le référentiel
(`docs/DEMO-COMMUNE.md`, `npm run demo-commun`).

## Besoin

Demande du propriétaire du 2 novembre 2026 : fusionner les ressources fictives des outils. Cursus fait foi pour les
salariés (D01) et publie `cursus.pub_salaries` ; Keystone rapproche une personne par matricule, puis par e-mail. Sa
démonstration n'attribue aucun matricule : le rapprochement ne se fait aujourd'hui que par l'e-mail des neuf personas.

## Demande

1. Renseigner dans la démonstration de Keystone (`persons`, ou la table de correspondance prévue) le matricule de Cursus
   des personnes internes : EMP-0025 Marie Lefebvre, EMP-0026 Romain Aubert, EMP-0027 Sophie Perrin, EMP-0028 Cédric
   Moreau, EMP-0029 Léa Marchand, EMP-0030 Damien Roux, EMP-0031 Camille Verdier, EMP-0032 Ines Duarte, EMP-0033 Marion
   Kerviel, EMP-0034 Antoine Girard, EMP-0035 Julien Wagner, EMP-0036 Samir Haddad, EMP-0037 Camille Morvan, EMP-0038
   Pauline Noguès, EMP-0039 Sophie Renard, EMP-0040 Olivier Blanc, EMP-0041 Lucas Fabre, EMP-0042 Amélie Ollivier,
   EMP-0043 Thomas Kerbrat, EMP-0044 Gabriel Comte, EMP-0045 Hélène Sauvage, EMP-0046 Fabien Bertrand, EMP-0056 David
   Imbert, EMP-0057 Karine Blanchard, EMP-0058 Arnaud Naveau, EMP-0059 Laure Fontaine. Les exemples déjà cités (EMP-0002,
   EMP-0012, EMP-0014, EMP-0018) gardent leur sens.
2. Harmoniser les prénoms : « Sami Haddad » → Samir Haddad, « Claire Morvan » → Camille Morvan, « Alain Girard » →
   Antoine Girard (comme Codex) ; prénoms des chefs de projet cités par initiale (« D. Imbert »…) : ceux du tableau.
3. Responsables : Keystone désigne Sophie Renard à la tête de MEP et Ines Duarte à la tête de « Controls & planning » ;
   Codex désigne Pauline Noguès et Marie Lefebvre. Cursus a retenu Codex comme managers d'équipe : à trancher.
4. Facultatif : adresses de démonstration en `@epc2i.example` (domaine réservé) au lieu de `@epc2i.fr`. Cursus garde
   pour l'instant les adresses `@epc2i.fr` des personas, pour que le rapprochement par e-mail fonctionne.
5. Les codes de projets du jeu de Cursus (`K-2614`, `K-2620`, `K-2611`, `K-2625`, `K-2631`, `K-2633`) sont inconnus de
   Keystone ; Cursus a ajouté HLT-026, NDC-031, RCF-019… à son cache. Facultatif : reprendre ces chantiers dans la
   démonstration de Keystone, ou les laisser propres à Cursus.

## Conformité (M-17, M-18)

Lecture par `cursus.pub_salaries` (lien existant) ; aucune écriture croisée, aucune vue nouvelle.
