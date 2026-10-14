# EZVIZ

Intègre à Gladys les **caméras et sonnettes EZVIZ** de votre compte EZVIZ, via
le **cloud EZVIZ** (celui qu’utilise l’app EZVIZ) : l’image de chaque alarme,
les détections de mouvement et de personne, les coups de sonnette, le mode
d’armement du compte (présent, absent, sommeil), le mode confidentialité, la
détection de mouvement marche/arrêt, le projecteur, la sirène, l’orientation
des caméras motorisées, la batterie, le signal Wi-Fi et la carte SD. Rien à
régler sur les caméras, aucun port à ouvrir : beaucoup de caméras EZVIZ
n’offrent ni ONVIF ni RTSP sans manipulation, le cloud les couvre toutes.

> **Développée sans le matériel : vos retours sont les bienvenus.** Cette
> intégration a été écrite à partir du travail de l’intégration `ezviz` de
> Home Assistant et de la bibliothèque pyEzviz, sans caméra ni compte EZVIZ
> sous la main. Si quelque chose ne marche pas comme décrit, ouvrez une issue
> sur
> [github.com/guim31/gladys-ezviz/issues](https://github.com/guim31/gladys-ezviz/issues)
> avec les logs de l’intégration (`LOG_LEVEL=debug`).
>
> Cette intégration n’est pas affiliée à EZVIZ ni à Hikvision. EZVIZ est une
> marque de Hangzhou EZVIZ Network Co., Ltd.

## Ce qu’il vous faut

- Un **compte EZVIZ** (l’e-mail ou le numéro de téléphone et le mot de passe
  de l’app EZVIZ) contenant vos caméras. Un second compte limité aux caméras
  voulues dans Gladys, partagé depuis l’app, est une bonne idée.
- Gladys **5.1 ou plus**, avec un accès à Internet.
- Facultatif : le **code de vérification** de chaque caméra (6 lettres
  majuscules sur l’étiquette sous la caméra, ou sur sa boîte), pour lire les
  images chiffrées et obtenir l’adresse RTSP.

## Mise en place

Ouvrez **Intégrations → EZVIZ → Configuration**, remplissez les réglages,
enregistrez, puis cliquez sur **Tester la connexion**. Ouvrez l’onglet
**Découverte** et ajoutez les caméras et l’appareil « Compte EZVIZ ».

### Réglages

- **E-mail ou numéro de téléphone** et **Mot de passe** : l’identifiant de
  l’app EZVIZ. Le mot de passe n’est envoyé qu’au cloud EZVIZ, sous forme
  d’empreinte, comme le fait l’app ; il n’est jamais écrit dans les logs ni
  sur le disque.
- **Serveur d’API** : laissez le serveur européen `apiieu.ezvizlife.com` :
  si votre compte est dans une autre région, EZVIZ le signale à la connexion
  et l’intégration suit. Sinon saisissez le serveur de votre région
  (`apiius.ezvizlife.com` pour l’Amérique, `apirus.ezvizru.com` pour la
  Russie) ou son code court (`us`).
- **Codes de vérification des caméras** (facultatif) : des paires
  `SÉRIE:CODE` séparées par des virgules, par exemple
  `BD1234567:ABCDEF, C78901234:GHIJKL`, ou un seul code pour toutes les
  caméras. Le numéro de série est sur la même étiquette. Nécessaire quand une
  caméra **chiffre ses images** (le « chiffrement des images » de l’app EZVIZ,
  actif par défaut sur beaucoup de modèles) et pour l’adresse RTSP.
- **Relève des alarmes** : la fréquence de lecture de la liste des alarmes
  (toutes les 15, 30, 60 ou 120 secondes ; 30 par défaut). Une seule requête
  lit les alarmes de toutes les caméras.
- **Images des caméras** : la fréquence d’une image neuve de chaque caméra
  **sur secteur** (toutes les 5, 15 ou 60 minutes, ou seulement à l’alarme).
  Les caméras sur batterie ne sont jamais réveillées par ce minuteur : leur
  image est celle de leur dernière alarme.
- **Autoriser l’armement depuis Gladys** (coché par défaut) : le mode
  d’armement se change depuis le tableau de bord, les scènes et le widget.
  Décochez pour seulement l’afficher.
- **Autoriser la sirène** (décoché par défaut) : ajoute un interrupteur de
  sirène aux caméras qui en ont une. Une sirène sonne une minute et réveille
  les voisins : ne cochez que si vous en avez besoin.
- **Langue des noms** : langue des noms de fonctionnalités et des textes
  envoyés aux scènes. Les noms sont fixés à l’ajout d’un appareil.

### Double authentification

Quand le compte a la double authentification, EZVIZ envoie un code par e-mail
ou SMS à la première connexion, et l’état de l’intégration l’indique. Ouvrez
**Saisir le code de vérification**, tapez le code et lancez l’action : Gladys
est connecté. Lancez-la avec un code vide pour en recevoir un nouveau. La
session est gardée dans le stockage de l’intégration : pas de nouveau code au
prochain redémarrage. Un code n’est redemandé que si EZVIZ met fin à la session
(mot de passe changé, Gladys retiré des appareils de confiance du compte).

### Actions de la configuration

- **Tester la connexion** : se connecte, lit le compte et dit combien de
  caméras ont été trouvées, et combien chiffrent leurs images sans code de
  vérification dans la configuration. Après un mot de passe refusé ou un
  compte bloqué, c’est aussi ainsi qu’on demande à l’intégration de
  réessayer.
- **Saisir le code de vérification** : voir ci-dessus.
- **Afficher l’adresse RTSP** : l’adresse vidéo locale d’une caméra (voir
  Vidéo en direct).

## Les appareils

### Caméras et sonnettes

Un appareil par caméra ou sonnette, nommé comme dans l’app EZVIZ, avec les
fonctionnalités du modèle :

- **Image** : l’image de la dernière alarme, les images neuves du minuteur, et
  une capture neuve quand vous ouvrez la caméra sur le tableau de bord (une
  caméra en veille ou hors ligne montre sa dernière image).
- **Orientation** (caméras motorisées) : les flèches de la caméra sur le
  tableau de bord ; chaque appui la tourne d’un pas.
- **Mouvement** : 1 pendant une minute après une alarme de détection
  (mouvement, personne ou autre alarme de la caméra), puis 0.
- **Sonnette** (sonnettes) : « Sonne » quelques secondes à chaque appui. Une
  caméra qu’EZVIZ ne classe pas comme sonnette reçoit cette fonctionnalité à
  son premier coup de sonnette.
- **Dernier événement** : quoi et quand, par exemple « Personne · 18:32 ».
- **En ligne** : si la caméra répond au cloud EZVIZ. Une caméra sur batterie
  est « éteinte » pendant sa veille : c’est normal.
- **Détection de mouvement** : les notifications d’alarme de la caméra
  activées ou non (la cloche de l’app EZVIZ).
- **Mode confidentialité** : le cache-objectif des modèles qui en ont un.
- **Projecteur** : la lumière des caméras à projecteur.
- **Sirène** : seulement si elle est autorisée dans la configuration ; elle
  s’arrête d’elle-même au bout d’une minute.
- **Batterie** : modèles sur batterie, en %.
- **Signal Wi-Fi** : de 0 à 100.
- **Carte SD** : Normale, Pas de carte, Erreur, Non formatée ou Formatage en
  cours.
- **Taille de la carte SD** : en Go (EZVIZ ne donne pas la place libre).

### Le compte

L’appareil **Compte EZVIZ** porte le **Mode d’armement** du compte, comme sur
l’accueil de l’app EZVIZ : **Présent**, **Absent** ou **Sommeil**. Ce que fait
chaque mode (quelle caméra détecte, sonne ou notifie) se règle dans l’app
EZVIZ. En lecture seule quand l’armement n’est pas autorisé dans la
configuration.

## Tableau de bord

Ajoutez les caméras à une pièce pour voir leur image, leurs flèches et leurs
interrupteurs, et le widget **EZVIZ** pour un coup d’œil : l’image de la
dernière alarme (d’une caméra, choisie dans les réglages du widget, ou de
toutes), le dernier événement, le mode d’armement, et trois boutons pour
changer de mode (le mode actuel porte une coche ; « Présent » demande une
confirmation, car il coupe les détections). Pas de bouton quand l’armement
n’est pas autorisé.

## Scènes

### Déclencheurs

- **Détection par une caméra EZVIZ** : une nouvelle alarme d’une caméra.
  Filtres : la caméra, et ce qui est détecté — mouvement, personne (quand la
  caméra les distingue) ou autre alarme. Informations transmises aux actions :
  le nom de la caméra, la détection (code et nom), le texte de l’alarme écrit
  par EZVIZ et son type EZVIZ. L’image de la caméra est déjà celle de l’alarme
  quand la scène démarre : « envoyer l’image de la caméra » l’envoie.
- **Quelqu’un sonne à une sonnette EZVIZ** : une sonnette a été pressée.
  Filtre : la sonnette. L’image de la caméra est celle du visiteur.

L’arrivée d’une nouvelle alarme met déjà à jour les fonctionnalités
**Mouvement** et **Sonnette** : un déclencheur sur ces fonctionnalités marche
aussi. Les déclencheurs ci-dessus ajoutent le type de détection et l’image de
l’alarme.

### Actions

- **Prendre une image EZVIZ neuve** : demande une image neuve à une caméra et
  l’envoie à Gladys, pour un « envoyer l’image de la caméra » juste après. Elle
  réveille une caméra sur batterie : à utiliser avec modération sur celles-ci.
- **Orienter une caméra EZVIZ** : un pas à gauche, à droite, en haut ou en
  bas.
- **Changer le mode d’armement EZVIZ** : présent, absent ou sommeil (si
  l’armement est autorisé dans la configuration).

### Idées de scènes

- **Tout le monde est parti** : quand la dernière personne quitte la maison,
  **Changer le mode d’armement EZVIZ** sur absent ; quand la première revient,
  sur présent.
- **Un visiteur à la porte** : sur **Quelqu’un sonne à une sonnette EZVIZ**,
  envoyer l’image de la sonnette sur Telegram avec « Quelqu’un est à la
  porte ».
- **Quelqu’un dans le jardin la nuit** : sur **Détection par une caméra
  EZVIZ**, filtrée sur la caméra du jardin et « personne », entre le coucher
  et le lever du soleil, allumer les lumières du jardin et envoyer l’image.
- **Intimité à la maison** : quand quelqu’un est à la maison, activer le
  **Mode confidentialité** de la caméra du salon ; le couper quand la maison
  est vide.

## Vidéo en direct (RTSP)

L’intégration donne des images à Gladys, pas une vidéo continue. Pour un flux
en direct, beaucoup de caméras EZVIZ servent du RTSP sur le réseau local :
activez-le dans l’app EZVIZ quand le modèle le propose (réglages de la caméra,
« Visionnage en LAN » ou « RTSP »), mettez le code de vérification de la
caméra dans la configuration, puis lancez **Afficher l’adresse RTSP** : copiez
l’adresse dans l’intégration « Caméra RTSP » de Gladys. L’adresse est
`rtsp://admin:<code>@<IP locale>:554/Streaming/Channels/101` (`102` pour le
flux secondaire, plus léger). Elle contient le code de la caméra : gardez-la
pour vous. Les caméras sur batterie et les sonnettes n’ont en général pas de
RTSP.

## Rafraîchissement et limites du cloud

EZVIZ n’a pas d’API publique pour ses comptes grand public : l’intégration
utilise l’API privée des apps EZVIZ, celle qu’utilise depuis des années
l’intégration `ezviz` de Home Assistant. EZVIZ ne publie aucun quota pour
elle ; l’intégration reste au rythme de Home Assistant ou plus lentement :

- les **alarmes** de toutes les caméras : une requête toutes les 30 secondes
  par défaut ;
- les **appareils** et le mode d’armement : toutes les 5 minutes, et juste
  après une commande ;
- les **captures** des caméras sur secteur : toutes les 15 minutes par défaut ;
- environ 3 500 requêtes par jour avec les réglages par défaut.

**Délai attendu** pour une détection ou un coup de sonnette : le temps que la
caméra envoie son alarme au cloud EZVIZ (quelques secondes, plus pour une
caméra sur batterie qui se réveille), plus au plus l’intervalle de relève des
alarmes — en général **5 à 40 secondes** avec les 30 secondes par défaut. Une
alarme que le cloud liste avec plus de 10 minutes de retard apparaît comme
dernier événement mais ne lance aucune scène. Gladys n’a jamais à interroger
les appareils : l’intégration les rafraîchit avec ses propres minuteurs.

## Dépannage

- **« EZVIZ a refusé l’e-mail ou le mot de passe »** : vérifiez-les dans l’app
  EZVIZ, corrigez-les dans la configuration et enregistrez. L’intégration ne
  réessaie pas d’elle-même un mot de passe refusé (EZVIZ bloque un compte
  après plusieurs échecs) : enregistrer ou **Tester la connexion** réessaie.
- **« EZVIZ a bloqué le compte »** : patientez, ou débloquez-le dans l’app
  EZVIZ (en réinitialisant le mot de passe si besoin), puis **Tester la
  connexion**.
- **« EZVIZ a envoyé un code de vérification »** : voir Double
  authentification.
- **Pas d’image, « l’image est chiffrée »** : ajoutez le code de vérification
  de la caméra à la configuration (ou coupez le chiffrement des images dans
  l’app EZVIZ). **Tester la connexion** indique combien de caméras sont
  concernées.
- **L’image d’une caméra sur batterie ne change jamais** : normal entre deux
  alarmes, l’intégration ne la réveille pas sur minuteur.
- **Une détection ne lance pas ma scène** : vérifiez le filtre « ce qui est
  détecté ». Certaines caméras signalent une personne comme une simple alarme
  de mouvement. Avec `LOG_LEVEL=debug`, chaque alarme est écrite avec son type
  et son texte EZVIZ : signalez-les dans une issue pour améliorer le
  classement.
- **Le cloud ne répond pas** : vérifiez l’accès à Internet de Gladys.
  L’intégration réessaie d’elle-même et le dit une fois dans les logs.

## Limites

- Cloud uniquement : pas de pilotage local, et rien ne marche quand le cloud
  EZVIZ ou l’accès à Internet est coupé (la vidéo RTSP, servie par la caméra,
  marche toujours).
- Une API non officielle : EZVIZ peut la changer sans prévenir.
- Pas de vidéo continue dans l’intégration (voir Vidéo en direct), pas
  d’audio bidirectionnel, pas d’enregistrements.
- Les prises, ampoules, serrures, centrales d’alarme et enregistreurs EZVIZ ne
  sont pas gérés ; seulement les caméras et sonnettes.
- Un seul mode d’armement pour tout le compte (le « groupe par défaut »
  d’EZVIZ).
- Le type d’une alarme (mouvement, personne, sonnette) est lu dans les codes
  de type EZVIZ connus à ce jour et dans son texte anglais : un modèle
  inhabituel peut signaler « autre alarme ».
- La place libre de la carte SD n’est pas donnée par le cloud.
- Un compte EZVIZ par Gladys.
