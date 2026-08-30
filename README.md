# MatrixAI

MatrixAI est un centre de contrôle web/PWA pour superviser et piloter une flotte Linux sans agent. Le hub collecte les métriques et exécute les actions via SSH.

- Dashboard temps réel : CPU, RAM, stockage, réseau, température, uptime et énergie.
- Gestion Docker, services systemd et bots Telegram machine par machine.
- Logs en direct via SSE (`journalctl -f`, `docker logs -f`, PM2).
- Détection automatique du matériel avant ajout : modèle, OS, CPU, RAM, disque et consommation suggérée.
- PWA responsive mobile/desktop avec navigation Android, safe areas et shell hors ligne.
- SQLite local, secrets SSH/sudo chiffrés en AES-256-GCM.

## Prérequis

### Hub MatrixAI

- Linux x86_64 ou ARM64 (Debian/Ubuntu/Raspberry Pi OS recommandés).
- Node.js **22 ou supérieur**.
- `ssh-keygen`, `ping` et `getent`.
- Outils de compilation (`python3`, `make`, `g++`) uniquement si aucun binaire `better-sqlite3` précompilé n'est disponible.

### Machines supervisées

- Serveur SSH accessible depuis le hub.
- Outils POSIX usuels : `sh`, `awk`, `grep`, `df`, `ps`.
- `systemctl`, Docker ou PM2 uniquement pour les fonctions correspondantes.

## Démarrage local

```bash
cp .env.example .env # facultatif : les variables doivent être exportées par votre shell
npm run install:all
npm run build
npm start
```

Ouvrez `http://localhost:3000`. Sur une installation neuve sans `MATRIXAI_ADMIN_PASSWORD`, les identifiants aléatoires sont écrits dans :

```text
server/data/bootstrap-credentials.txt
```

Supprimez ce fichier après la première connexion et changez immédiatement le mot de passe dans **Réglages**.

Commandes utiles :

```bash
npm test       # tests serveur + client
npm run check  # tests + build production
npm run doctor # vérification de l'environnement
npm run dev:web
npm run dev:server
```

## Installation Linux avec systemd

Depuis un checkout ou une archive de release :

```bash
sudo ./scripts/install.sh
```

L'installateur crée :

- code immuable : `/opt/matrixai` ;
- données et clés : `/var/lib/matrixai` (mode `0700`) ;
- configuration : `/etc/matrixai/matrixai.env` (mode `0600`) ;
- service : `matrixai.service`, exécuté par l'utilisateur système non privilégié `matrixai`.

```bash
sudo systemctl status matrixai
sudo journalctl -u matrixai -f
sudo systemctl restart matrixai
```

Pour une mise à jour, récupérez la nouvelle version puis relancez `sudo ./scripts/install.sh`. Le dossier de données n'est pas écrasé.

## Configuration

Voir [`deploy/matrixai.env.example`](deploy/matrixai.env.example).

| Variable | Défaut | Description |
|---|---:|---|
| `HOST` | `0.0.0.0` | Adresse d'écoute |
| `PORT` | `3000` | Port HTTP |
| `MATRIXAI_DATA_DIR` | `server/data` | Base SQLite, secret et clés SSH |
| `MATRIXAI_WEB_DIST` | `web/dist` | Frontend construit |
| `MATRIXAI_LAN` | `192.168.1.0/24` | Réseau du scanner |
| `COLLECT_INTERVAL_MS` | `5000` | Intervalle de collecte, minimum 2 s |
| `MATRIXAI_TRUST_PROXY` | `0` | À activer derrière un proxy de confiance |
| `MATRIXAI_ENABLE_REMOTE_EXEC` | `0` | Endpoint shell arbitraire, fortement déconseillé |

Le secret de chiffrement est généré automatiquement dans `$MATRIXAI_DATA_DIR/.secret`. Sauvegardez ce fichier avec la base : sans lui, les identifiants SSH stockés sont irrécupérables.

## HTTPS et PWA

Un service worker exige HTTPS, sauf sur `localhost`. Pour installer MatrixAI comme PWA sur Android/Pixel :

- utilisez **Tailscale Serve** avec HTTPS ; ou
- placez Caddy/Nginx devant `127.0.0.1:3000` avec un certificat approuvé.

Exemple Tailscale :

```bash
sudo tailscale serve --bg https / http://127.0.0.1:3000
```

Puis ouvrez l'URL HTTPS Tailscale dans Chrome Android et choisissez **Installer l'application**.

Le mode hors ligne conserve uniquement le shell statique. Les données temps réel et commandes restent désactivées lorsque le hub est inaccessible.

## Ajouter une machine

1. **Réglages → Ajouter une machine**.
2. Entrez IP/hôte, utilisateur et mot de passe SSH.
3. Cliquez sur **Détecter les caractéristiques** pour prévisualiser matériel et OS.
4. Activez **Installer la clé SSH du hub** pour les connexions futures sans mot de passe.
5. Enregistrez.

Le mot de passe SSH initial n'est envoyé qu'au hub. La clé est installée via la bibliothèque Node `ssh2` ; `sshpass` n'est pas requis.

## Sauvegarde et restauration

Arrêtez brièvement le service afin d'obtenir un snapshot SQLite cohérent :

```bash
sudo systemctl stop matrixai
sudo tar -C /var/lib -czf matrixai-backup.tgz matrixai
sudo systemctl start matrixai
```

Restauration :

```bash
sudo systemctl stop matrixai
sudo tar -C /var/lib -xzf matrixai-backup.tgz
sudo chown -R matrixai:matrixai /var/lib/matrixai
sudo chmod -R go-rwx /var/lib/matrixai
sudo systemctl start matrixai
```

## Architecture

```text
Navigateur / PWA
       │ HTTPS + WebSocket + SSE
       ▼
MatrixAI Hub (Fastify + React + SQLite)
       │ SSH
       ├── NAS
       ├── Raspberry Pi
       └── NUC / serveurs Linux
```

Les WebSockets exigent une session authentifiée. Les mutations intersites sont refusées. L'endpoint d'exécution SSH arbitraire est désactivé par défaut.

## CI et qualité

GitHub Actions exécute :

- tests Node 22 et 24 ;
- build production React/Vite ;
- démarrage depuis un répertoire de données vierge et healthcheck HTTP ;
- arrêt gracieux `SIGTERM` ;
- contrôle anti-fuite des DB, clés, données et `.env` ;
- analyse CodeQL et mises à jour Dependabot.

Avant une contribution :

```bash
npm run install:all
npm run check
```

## Sécurité

- N'exposez pas directement le port 3000 à Internet.
- Utilisez HTTPS via Tailscale ou un reverse proxy.
- Limitez les règles sudo sur les machines supervisées selon votre politique.
- Sauvegardez ensemble la base SQLite et `.secret`.
- Ne versionnez jamais `server/data`, `web/dist` ou un fichier `.env`.

## Licence

Aucune licence open source n'est déclarée pour le moment. Ajoutez un fichier `LICENSE` avant une publication publique si nécessaire.
# matrix
# matrix
