---
name: publish
description: Publie le travail accumulé sur la branche `dev` — commit/push de ce qui reste, PR `dev` → `main` sur origin puis merge (merge commit, historique des commits conservé) qui déclenche la release. À utiliser quand l'utilisateur demande /publish ou de « publier » le travail en cours.
---

# Publish

Flux de travail de Carlo :

- Tout le travail se fait sur la branche durable **`dev`** : un commit par changement, poussé régulièrement sur `origin/dev`.
- `main` ne bouge que par `/publish` : PR `dev` → `main`, mergée par **merge commit**.
  Les commits de `dev` arrivent sur `main` avec leurs hash d'origine : `dev` ne diverge jamais de `main`, aucun force-push.
- Chaque push sur `main` publie une release dont les notes listent **chaque commit** (hors merge commits) depuis la release précédente.
  Les messages de commit sont donc les lignes des release notes.

L'invocation de ce skill vaut autorisation explicite de commit, push, ouvrir et merger la PR.
Ne demande pas de confirmation supplémentaire, sauf si une vérification ci-dessous échoue.

## 1. Vérifications préalables

```sh
git branch --show-current
git status --short
git fetch --prune origin
```

- Si la branche courante n'est pas `dev` :
  - `main` avec des modifications non commitées et/ou des commits locaux en avance sur `origin/main` :
    bascule-les sur `dev` (`git switch dev` emporte les modifications non commitées ; des commits locaux sur `main`
    se rapatrient avec `git switch dev && git merge --ff-only main` si possible, sinon arrête-toi et rapporte).
    Remets ensuite `main` au niveau d'`origin/main` : `git branch -f main origin/main` (depuis `dev`).
  - Une autre branche : arrête-toi et demande quoi faire.
  - `dev` n'existe pas encore : `git switch -c dev origin/main` (ou depuis `main`), puis `git push -u origin dev`.
- `dev` doit contenir `origin/main` (`git merge-base --is-ancestor origin/main dev`). Sinon (commit poussé
  directement sur `main`), fais `git merge --ff-only origin/main` si possible, sinon `git merge origin/main`
  et signale-le ; en cas de conflit, arrête-toi.
- S'il n'y a rien à committer **et** aucun commit d'avance (`git log origin/main..dev`), indique qu'il n'y a rien à publier et arrête-toi.

## 2. Validation

Lance les vérifications du projet (cf. `AGENTS.md`) :

```sh
npm run typecheck
npm run lint
npm run build
```

Si les changements ne touchent que de la documentation ou `.claude/`, tu peux les sauter en le signalant.
Si une commande échoue, **arrête-toi** : ne commit pas, ne pousse pas, rapporte l'erreur.

## 3. Commit

S'il reste des changements non commités :

- Utilise le skill `git-commit` s'il est disponible ; sinon écris un message au format Conventional Commits
  (`feat(scope): …`, `fix(scope): …`, `ci: …`, `chore: …`), cohérent avec `git log --oneline -10`.
- Chaque commit devient une ligne des release notes : un commit par changement distinct,
  avec un sujet compréhensible par un utilisateur (pas de « wip », « fix typo », commit fourre-tout).
- N'ajoute jamais de fichiers secrets (`.env`, credentials, `.claude/settings.local.json`).
- `.claude/` est dans `.gitignore` : un fichier sous `.claude/` qui doit être versionné s'ajoute avec `git add -f`.

## 4. Push

Toujours vers `origin`, jamais vers `upstream`, jamais `--force` :

```sh
git push -u origin dev
```

## 5. Ouverture de la PR

Cible explicitement le dépôt d'`origin` pour que `gh` ne choisisse pas `upstream` :

```sh
REPO=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
gh pr view dev --repo "$REPO" --json state,url 2>/dev/null   # réutilise une PR OPEN existante
gh pr create --repo "$REPO" --base main --head dev \
  --title "<résumé de la publication>" \
  --body "<liste des commits + vérifications effectuées>"
```

- Titre : le sujet du commit s'il n'y en a qu'un, sinon un résumé court au format Conventional Commits
  (ex. `feat: PDF preview, LSP fixes`). Il n'apparaît pas dans les release notes (merge commit exclu).
- Corps : `git log --reverse --format='- %s' origin/main..dev`, puis les commandes de validation lancées (avec leur résultat).

## 6. Merge

```sh
gh pr merge dev --repo "$REPO" --merge
```

- **Jamais** `--delete-branch` : `dev` est durable. Jamais `--squash` ni `--rebase` : ils réécriraient les commits
  et feraient diverger `dev` de `main`.
- Si le merge est refusé (conflits, checks requis, protection de branche), **ne force rien** :
  laisse la PR ouverte et rapporte la raison avec l'URL de la PR.

## 7. Resynchronisation

Uniquement si `gh pr view dev --repo "$REPO" --json state -q .state` affiche `MERGED` :

```sh
git fetch --prune origin
git switch dev                         # gh a pu basculer le checkout
git merge --ff-only origin/main        # récupère le merge commit : dev == main
git push origin dev
git branch -f main origin/main         # main local à jour, sans quitter dev
```

Le travail reprend ensuite sur `dev`.

## 8. Rapport

Termine avec :

- les commits publiés (hash court + sujet), qui seront les lignes des release notes,
- l'URL de la PR et son état final (mergée, ou restée ouverte avec la raison),
- l'état de `dev` et `main` après resynchronisation,
- un rappel que le workflow Release tourne sur `main` (Actions) et qu'ensuite `/update-carlo` installe la build.
