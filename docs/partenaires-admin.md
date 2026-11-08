# Partenaires : réglages côté Achievers

Ce qu'un administrateur d'Achievers fait pour brancher un site partenaire (Lure). Le guide à
envoyer au partenaire est [api-partenaires.md](api-partenaires.md).

Tout se règle dans **Modération → Sites partenaires**, ligne du partenaire. Chaque secret ne
s'affiche qu'une fois : envoie-le tout de suite au partenaire, par message privé. Les boutons
« Remplacer la clé », « Nouveau secret » et « Nouveau secret client » en génèrent un autre et
coupent l'ancien.

| Le partenaire veut                  | Il te donne                                    | Tu fais                                                                                   | Tu lui renvoies                                    |
| ----------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Lire l'API, relier Lure → Achievers | rien                                           | « Créer une clé »                                                                         | la clé `ak_…`                                      |
| Recevoir les webhooks               | son adresse HTTPS                              | identifiant `lure` dans le premier champ, son adresse dans le second, Enregistrer         | le secret `whsec_…`                                |
| « Se connecter avec Achievers »     | son adresse de retour                          | la coller dans « Adresses de retour OAuth », Enregistrer les adresses                     | `client_id` (`ach_…`) et `client_secret` (`acs_…`) |
| Relier Achievers → Lure             | l'adresse de son site et une clé qu'il a créée | `LURE_API_URL` et `LURE_API_KEY` dans le `.env` du NAS, puis `bash scripts/deploy-nas.sh` | rien                                               |

L'identifiant `lure` doit être exactement celui-ci : c'est le nom sous lequel Achievers range les
comptes reliés automatiquement.

L'état des webhooks (dernier envoi réussi, échecs d'affilée et dernière erreur) s'affiche sous la
ligne du partenaire. Un changement du `.env` ne passe pas par le déploiement automatique : il faut
le script ci-dessus.

Côté joueurs : `/compte` montre les comptes partenaires reliés (avec « Délier ») et les
applications autorisées (avec « Retirer l'accès ») ; `/confidentialite` dit ce qu'un partenaire
reçoit.
