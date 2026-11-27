# Démonstration commune des outils

Demande du propriétaire du 2 novembre 2026 : « fusionne les ressources fictives des différents outils ; on videra la base
avant de passer en production et de faire la connexion à la bibliothèque Entra ID pour récupérer tous les utilisateurs du
domaine ». Cursus fait foi pour les salariés (décision D01 de Matrix) et publie `cursus.pub_salaries` (matricule, nom,
poste, `unite_code`, `site_code`, entrée, sortie, actif) : les autres outils rapprochent une personne par matricule
(Keystone : matricule, puis e-mail). La démonstration de Cursus porte donc aussi les personnes fictives de Keystone, Codex,
Vigie et Crucible, sous des matricules fixés ici. **Toutes ces données sont fictives** ; elles partent avec la purge
(`npm run purge-demo`) avant la mise en production.

## Mise en œuvre

- Module `server/src/seed-commun.ts` : `ajouterReferentielCommun(db)`, idempotent (rejoué, il n'ajoute que ce qui
  manque), en une transaction, refusé sur une base sans le marqueur de démonstration (réglage `demo`), purgée ou
  exploitée, ou dont un identifiant 25 à 81 est pris par une autre fiche. Aucune table, aucune colonne ni migration
  nouvelle ; aucune vue `pub_` touchée.
- `npm run demo-commun` (`--a-blanc` : ce qui serait ajouté, rien n'est écrit), sur le fichier SQLite ou sur le serveur
  PostgreSQL (`DATABASE_URL`) ; à lancer après la reprise de la démonstration (`docs/DEPLOIEMENT.md`).
- `CURSUS_DEMO_COMMUN=1` (avec `CURSUS_DEMO=1`) : le premier amorçage de la démonstration, « Réinitialiser la
  démonstration » (Paramètres) et `npm run reset-demo` ajoutent aussi le référentiel commun. Sans elle, la démonstration
  garde ses 24 salariés (tests, application de bureau).
- Journal : une ligne `demo.commun` (décomptes et codes de sites, jamais un nom).
- Purge : fiches, comptes, certifications, projets, chantier et affectations partent avec les données fictives. Le
  réglage `demoCommun` relève ce que l'ajout a réellement créé ou posé (cumulé sur les exécutions successives) : sites
  et équipes absents avant lui, postes créés pour ses fiches, site et unité posés sur les équipes existantes (seulement
  les champs alors vides), site posé sur l'entité. `retirerReferentielCommun` ne retire que cela, après les fiches :
  équipes et postes créés qu'aucune fiche ne désigne plus, sites créés (une équipe ou l'entité rattachée depuis à l'un
  d'eux voit son site remis à vide), site et unité remis à vide seulement s'ils valent encore la valeur posée. Le
  paramétrage du service RH, saisi avant ou après l'ajout (site `lyon` créé à la main, équipe « Direction » homonyme,
  poste « Magasinier » avec ses exigences, équipe rattachée à `lyon`, rattachement refait), est gardé, comme le profil
  `parametrage` le veut. Le nom « Société mère » donné à l'entité reste.
- Adresses : toutes en `@atrium.example` (domaine fictif réservé), comme les personas de Keystone, de Crucible et de
  Vigie depuis le renommage de la suite en Atrium (27 novembre 2026), pour le rapprochement par e-mail. Aucun
  e-mail ne part d'une instance de démonstration, même avec `CURSUS_MAIL_*` posées (`configMail`, server/src/config.ts :
  toujours en simulation avec `CURSUS_DEMO=1`) ; ne pas lever cette garde sur l'instance commune. Ces fiches et leurs
  comptes partent avec la purge comme les autres (reconnues par le réglage `demoCommun` et `cree_par`, pas par le
  domaine).

## Sites (cache de `matrix.pub_sites`)

| Code | Libellé | Origine |
| --- | --- | --- |
| `lyon` | Lyon — siège et atelier | Matrix (amorcé depuis Codex) ; Vigie `ville-a` |
| `le_havre` | Le Havre — magasin | Matrix |
| `marseille` | Marseille — magasin | Matrix |
| `lyon_essais` | Lyon — zone d'essais | Vigie `ville-b` (zone d'essais), hors format Matrix chez Vigie |
| `site_rd` | Site d'essais R&D | Crucible `RD-SITE`, hors format Matrix chez Crucible |

`lyon_essais` et `site_rd` ne sont pas dans `matrix.sites` : à y ajouter (demande à Matrix) ou à corriger.

## Équipes et unités de l'organigramme de Matrix

Les six équipes du jeu gardent leur nom et leur manager ; elles reçoivent le site `lyon` et une unité : Production
`CHA-PROD`, Maintenance `CHA-MAINT`, Logistique `ACH-LOG`, Qualité & HSE `HSE-QHSE`, Administration `RHU-ADM`,
Commercial `COM-VENTE`. Équipes ajoutées (manager = responsable de département de Codex, `HOLDERS` de
`src/db/seed-org.ts`, ou chef d'atelier de Vigie) :

| Équipe | Unité | Site | Rattachée à | Manager |
| --- | --- | --- | --- | --- |
| Direction | DIR | lyon | — | EMP-0048 Hélène Costa |
| Projets | PRJ | lyon | — | EMP-0025 Marie Lefebvre |
| Ingénierie | ING | lyon | — | EMP-0033 Marion Kerviel |
| MEP | MEP | lyon | — | EMP-0038 Pauline Noguès |
| Chantier | CHA | le_havre | — | EMP-0040 Olivier Blanc |
| Qualité | QUA | lyon | — | EMP-0044 Gabriel Comte |
| HSE | HSE | lyon | — | EMP-0047 Claire Bardet |
| Achats | ACH | marseille | — | EMP-0046 Fabien Bertrand |
| RH | RHU | lyon | — | EMP-0049 Nadia Benali |
| Finance | FIN | lyon | — | EMP-0050 Thomas Weil |
| Juridique | JUR | lyon | — | EMP-0051 Inès Rahmani |
| SI | DSI | lyon | — | EMP-0052 Marc Delorme |
| Communication | CMN | lyon | — | EMP-0053 Lucie Martin |
| R&D | RDI | lyon | — | EMP-0054 Yasmine Aït-Saïd |
| Projets Le Havre | PRJ-HAVRE | le_havre | Projets | EMP-0026 Romain Aubert |
| Bureau d'études | ING-BE | lyon | Ingénierie | EMP-0033 Marion Kerviel |
| Zone d'essais | ING-ESSAIS | lyon_essais | Ingénierie | EMP-0073 Jérôme Petit |
| Atelier montage | CHA-MONTAGE | lyon | Chantier | EMP-0077 Stéphane Benali |
| Atelier usinage | CHA-USINAGE | lyon | Chantier | EMP-0040 Olivier Blanc (aucun chef d'atelier dans Vigie) |
| Magasin | ACH-MAGASIN | lyon | Achats | EMP-0046 Fabien Bertrand |
| Essais R&D | RDI-ESSAIS | site_rd | R&D | EMP-0060 Hélène Marchal |

Les équipes racines relèvent de l'entité unique (société « Société mère », site `lyon`). Le site d'une fiche est celui de son
équipe : les personnes d'un autre site que leur département ont une équipe rattachée (Projets Le Havre, Zone d'essais,
Essais R&D).

## Personnes (matricule → personne → outils)

EMP-0001 à EMP-0024 (jeu de Cursus) ne bougent pas. Outils : K Keystone, C Codex, V Vigie, Cr Crucible. Contrats CDI
(cadres au forfait annuel en jours, techniciens à 39 h avec RTT, ouvriers à 35 h), entrées passées, aucune donnée de
santé ; quelques formations (SST, habilitation électrique, CACES, travail en hauteur, EPI). Adresse : celle de l'outil
source (Keystone, Crucible et Vigie, toutes en `@atrium.example`), sinon `prenom.nom@atrium.example`.

| Matricule | Personne | Poste | Équipe | Unité | Site | Adresse | Outils |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EMP-0025 | Marie Lefebvre | Directrice de portefeuille | Projets | PRJ | lyon | marie.lefebvre@atrium.example | K, C |
| EMP-0026 | Romain Aubert | Chef de projet | Projets Le Havre | PRJ-HAVRE | le_havre | romain.aubert@atrium.example | K, C |
| EMP-0027 | Sophie Perrin | Cheffe de projet | Projets | PRJ | lyon | sophie.perrin@atrium.example | K, C |
| EMP-0028 | Cédric Moreau | Chef de projet | Projets | PRJ | lyon | cedric.moreau@atrium.example | K, C |
| EMP-0029 | Léa Marchand | Contrôleuse de gestion | Projets | PRJ | lyon | lea.marchand@atrium.example | K, C |
| EMP-0030 | Damien Roux | Planificateur | Projets | PRJ | lyon | damien.roux@atrium.example | K |
| EMP-0031 | Camille Verdier | Coordinatrice logistique | Projets | PRJ | lyon | camille.verdier@atrium.example | K |
| EMP-0032 | Ines Duarte | Responsable contrôle de projet | Projets | PRJ | lyon | ines.duarte@atrium.example | K |
| EMP-0033 | Marion Kerviel | Responsable ingénierie | Ingénierie | ING | lyon | marion.kerviel@atrium.example | K, C |
| EMP-0034 | Antoine Girard | Référent ingénierie | Ingénierie | ING | lyon | antoine.girard@atrium.example | K, C |
| EMP-0035 | Julien Wagner | Ingénieur structure | Ingénierie | ING | lyon | julien.wagner@atrium.example | K, C |
| EMP-0036 | Samir Haddad | Ingénieur électricité | Ingénierie | ING | lyon | samir.haddad@atrium.example | K (« Sami »), C |
| EMP-0037 | Camille Morvan | Automaticienne | Ingénierie | ING | lyon | camille.morvan@atrium.example | K (« Claire »), C |
| EMP-0038 | Pauline Noguès | Responsable MEP | MEP | MEP | lyon | pauline.nogues@atrium.example | K, C |
| EMP-0039 | Sophie Renard | Ingénieure MEP | MEP | MEP | lyon | sophie.renard@atrium.example | K |
| EMP-0040 | Olivier Blanc | Responsable opérations chantier | Chantier | CHA | le_havre | olivier.blanc@atrium.example | K, C |
| EMP-0041 | Lucas Fabre | Responsable de chantier | Chantier | CHA | le_havre | lucas.fabre@atrium.example | K, C |
| EMP-0042 | Amélie Ollivier | Cheffe de site | Chantier | CHA | le_havre | amelie.ollivier@atrium.example | K |
| EMP-0043 | Thomas Kerbrat | Opérations de levage | Chantier | CHA | le_havre | thomas.kerbrat@atrium.example | K |
| EMP-0044 | Gabriel Comte | Responsable qualité | Qualité | QUA | lyon | gabriel.comte@atrium.example | K, C |
| EMP-0045 | Hélène Sauvage | Technicienne QA/QC | Qualité | QUA | lyon | helene.sauvage@atrium.example | K, C |
| EMP-0046 | Fabien Bertrand | Responsable achats et stock | Achats | ACH | marseille | fabien.bertrand@atrium.example | K, C |
| EMP-0047 | Claire Bardet | Responsable HSE et gestion documentaire | HSE | HSE | lyon | claire.bardet@atrium.example | C |
| EMP-0048 | Hélène Costa | Directrice générale | Direction | DIR | lyon | helene.costa@atrium.example | C |
| EMP-0049 | Nadia Benali | Responsable RH | RH | RHU | lyon | nadia.benali@atrium.example | C |
| EMP-0050 | Thomas Weil | Responsable financier | Finance | FIN | lyon | thomas.weil@atrium.example | C |
| EMP-0051 | Inès Rahmani | Juriste | Juridique | JUR | lyon | ines.rahmani@atrium.example | C |
| EMP-0052 | Marc Delorme | Responsable SI | SI | DSI | lyon | marc.delorme@atrium.example | C |
| EMP-0053 | Lucie Martin | Chargée de communication | Communication | CMN | lyon | lucie.martin@atrium.example | C |
| EMP-0054 | Yasmine Aït-Saïd | Responsable R&D | R&D | RDI | lyon | yasmine.ait.said@atrium.example | C |
| EMP-0055 | James Holt | Auditeur interne | Qualité | QUA | lyon | james.holt@atrium.example | C |
| EMP-0056 | David Imbert | Chef de projet | Projets | PRJ | lyon | david.imbert@atrium.example | K (« D. Imbert ») |
| EMP-0057 | Karine Blanchard | Cheffe de projet | Projets | PRJ | lyon | karine.blanchard@atrium.example | K (« K. Blanchard ») |
| EMP-0058 | Arnaud Naveau | Chef de projet | Projets | PRJ | lyon | arnaud.naveau@atrium.example | K (« A. Naveau ») |
| EMP-0059 | Laure Fontaine | Cheffe de projet | Projets | PRJ | lyon | laure.fontaine@atrium.example | K (« L. Fontaine ») |
| EMP-0060 | Hélène Marchal | Directrice R&D | Essais R&D | RDI-ESSAIS | site_rd | h.marchal@atrium.example | Cr |
| EMP-0061 | Antoine Leroy | Coordinateur des moyens d’essais | Essais R&D | RDI-ESSAIS | site_rd | a.leroy@atrium.example | Cr |
| EMP-0062 | Nathalie Brun | Référente sécurité pyrotechnique | Essais R&D | RDI-ESSAIS | site_rd | n.brun@atrium.example | Cr |
| EMP-0063 | Damien Petit | Responsable du PDE | Essais R&D | RDI-ESSAIS | site_rd | d.petit@atrium.example | Cr |
| EMP-0064 | Camille Fabre | Cheffe de projet R&D | Essais R&D | RDI-ESSAIS | site_rd | c.fabre@atrium.example | Cr |
| EMP-0065 | Julien Masson | Technicien d’essais | Essais R&D | RDI-ESSAIS | site_rd | j.masson@atrium.example | Cr |
| EMP-0066 | Olivier Caron | Responsable ingénierie | Ingénierie | ING | lyon | o.caron@atrium.example | Cr |
| EMP-0067 | Sandrine Roux | Responsable du laboratoire 67 | Essais R&D | RDI-ESSAIS | site_rd | s.roux@atrium.example | Cr |
| EMP-0068 | Mehdi Arnaud | Chef de projet R&D | Essais R&D | RDI-ESSAIS | site_rd | m.arnaud@atrium.example | Cr |
| EMP-0069 | Thierry Nguyen | Monteur | Atelier montage | CHA-MONTAGE | lyon | t.nguyen@atrium.example | V |
| EMP-0070 | Michel Girard | Usineur | Atelier usinage | CHA-USINAGE | lyon | m.girard@atrium.example | V |
| EMP-0071 | Paul Roux | Usineur | Atelier usinage | CHA-USINAGE | lyon | p.roux@atrium.example | V |
| EMP-0072 | Alice Martin | Technicienne d’essais | Zone d’essais | ING-ESSAIS | lyon_essais | a.martin@atrium.example | V |
| EMP-0073 | Jérôme Petit | Chef de zone d’essais | Zone d’essais | ING-ESSAIS | lyon_essais | j.petit@atrium.example | V |
| EMP-0074 | René Fontaine | Magasinier | Magasin | ACH-MAGASIN | lyon | r.fontaine@atrium.example | V |
| EMP-0075 | Émilie Dubois | Ingénieure bureau d’études | Bureau d’études | ING-BE | lyon | e.dubois@atrium.example | V |
| EMP-0076 | Laurent Moreau | Responsable qualité atelier | Qualité | QUA | lyon | l.moreau@atrium.example | V |
| EMP-0077 | Stéphane Benali | Chef d’atelier montage | Atelier montage | CHA-MONTAGE | lyon | s.benali@atrium.example | V |
| EMP-0078 | Kevin Bernard | Monteur | Atelier montage | CHA-MONTAGE | lyon | k.bernard@atrium.example | V |
| EMP-0079 | Céline Lefèvre | Animatrice QHSE | HSE | HSE | lyon | c.lefevre@atrium.example | V |
| EMP-0080 | Henri Marchand | Directeur de site | Direction | DIR | lyon | h.marchand@atrium.example | V |
| EMP-0081 | Yves Lambert | Usineur | Atelier usinage | CHA-USINAGE | lyon | y.lambert@atrium.example | V |

EMP-0081 Yves Lambert est sorti (CDD arrivé à son terme le 1er octobre 2026, « Fin de contrat » dans Vigie). EMP-0049
Nadia Benali a le profil gestionnaire RH ; les autres comptes ajoutés n'ont aucun profil RH.

**Aucune fiche** pour les personnes externes : clients (Nadia Bensaïd de Keystone…), contacts des filiales APM et SAI
d'Arche, responsables de zone de Keystone (Olivier Castel, Aïcha Diallo, Sophie Nguyen), Filiale partenaire de
Crucible (Isabelle Garnier), contacts des entreprises extérieures de Vigie, comptes techniques (Codex, Keystone, Vigie,
administrateur de Crucible).

## Projets de Keystone (cache Keystone de Cursus)

Codes et noms de `src/server/prototype/prototype-generated.json` de Keystone : HLT-026, NDC-031, RCF-019, ERP-202,
WSA-044, MSR-012, EWA-051, FTU-052, RBR-048, CER-047, PRS-038, ALP-021 (actifs) ; DRR-009, HRM-011, QFR-015, TTR-017,
SCP-033 (clos ou annulés : archivés). Chantier HLT-026 (Le Havre — quai 4, du 12 octobre au 18 décembre 2026,
responsable Lucas Fabre), sans exigence du Go / No Go ; affectations : Lucas Fabre, Amélie Ollivier, Thomas Kerbrat,
Julien Wagner, Hélène Sauvage, Pauline Noguès, et EMP-0018 Romain Chevalier (du 7 au 11 décembre, avec une tâche
planifiée de 35 h), comme l'exemple d'heures validées de Matrix (`data/contrats/heures-validees.schema.json`).

## Homonymes et écarts relevés (2 novembre 2026)

- **Antoine Leroy** : EMP-0014 (chargé RH de Cursus) et EMP-0061 (coordinateur des moyens d'essais de Crucible) sont deux
  personnes distinctes, distinguées par matricule et par adresse (`antoine.leroy@entreprise.example`,
  `a.leroy@atrium.example`).
- Autres homonymies de nom de famille sans conséquence : Roux, Girard, Moreau, Martin, Fontaine, Petit, Benali, Fabre,
  Marchand, Lambert, Bernard, Perrin entre le jeu de Cursus et les autres outils.
- **Keystone** : « Sami Haddad » (Codex : Samir Haddad, retenu), « Claire Morvan » (Codex : Camille Morvan, retenu),
  « Alain Girard » dans certaines données (personas : Antoine Girard, retenu). Chefs de projet cités par initiale
  seulement (« D. Imbert », « K. Blanchard », « A. Naveau », « L. Fontaine ») : prénoms choisis ici.
- **Responsables incohérents** : MEP — Keystone Sophie Renard, Codex Pauline Noguès (retenue comme manager) ; projets et
  contrôle — Keystone Ines Duarte (« Controls & planning »), Codex Marie Lefebvre (retenue). Responsable R&D : Codex
  Yasmine Aït-Saïd, Crucible Hélène Marchal (« Head of R&D ») ; responsable ingénierie : Keystone et Codex Marion Kerviel,
  Crucible Olivier Caron ; responsable qualité : Gabriel Comte (Keystone, Codex) et « [L. Moreau] » (Vigie).
- **Vigie** : 13 personnes « [C. Lefèvre] » à l'initiale seule (prénoms choisis d'après l'initiale), sites `ville-a`,
  `ville-b` (et `ville-c` fermé) hors des codes de Matrix ; projets `K-2024-097`… inconnus de Keystone.
- **Crucible** : site `RD-SITE` hors format Matrix, codes d'entités hors format Matrix (société et filiale partenaire).
- **Cursus** : codes de projets du jeu `K-2614`, `K-2620`, `K-2611`, `K-2625`, `K-2631`, `K-2633` inconnus de
  Keystone (gardés : ils portent les chantiers et le Go / No Go du jeu) ; signataires sans fiche (Sandrine Vidal,
  Olivier Marchal, Philippe Aubert, Jean-Marc Perret) gardés tels quels.
- **Adresses** : Keystone `@atrium.example`, Vigie et Crucible `@atrium.example`, Codex sans adresse, Cursus
  `@entreprise.example`. `pub_salaries` ne publie pas l'adresse (M-18 : à demander à Matrix comme une publication).

## Demandes aux autres outils (à valider par le propriétaire)

`docs/demandes/demo-commune-keystone.md`, `-vigie.md`, `-codex.md`, `-crucible.md`, `-matrix.md` : renseigner ces
matricules dans leur démonstration, harmoniser prénoms et sites, éventuellement les adresses `@atrium.example`. Rien
n'est écrit dans leurs dépôts.
