---
name: publish
description: Publie le travail terminé d'un worktree — commit, push de la branche, ouverture d'une PR sur origin puis merge (squash) qui ferme la PR. À utiliser quand l'utilisateur demande /publish ou de « publier » le travail d'un worktree.
---

# Publish

Publie le travail d'un worktree Carlo en une seule passe :
commit → push de la branche → ouverture de la PR → merge (ce qui ferme la PR) → récupération de `main` → nettoyage du worktree.

L'invocation de ce skill vaut autorisation explicite de commit, push, ouvrir et merger la PR.
Ne demande pas de confirmation supplémentaire, sauf si une vérification ci-dessous échoue.

## 1. Vérifications préalables

```sh
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

- Le répertoire courant doit être un worktree (chemin sous `.claude/worktrees/`). Sinon, arrête-toi et demande.
- La branche courante ne doit **jamais** être `main`/`master`. Sinon, arrête-toi.
- S'il n'y a rien à committer **et** aucun commit d'avance sur `origin/main` (`git log origin/main..HEAD`), indique qu'il n'y a rien à publier et arrête-toi.

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

S'il y a des changements non commités :

- Utilise le skill `git-commit` s'il est disponible ; sinon écris un message au format Conventional Commits
  (`feat(scope): …`, `fix(scope): …`, `chore: …`), cohérent avec `git log --oneline -10`.
- N'ajoute jamais de fichiers secrets (`.env`, credentials, `.claude/settings.local.json`).
- `.claude/` est dans `.gitignore` : un fichier sous `.claude/` qui doit être versionné s'ajoute avec `git add -f`.

## 4. Push

Toujours vers `origin` (le fork), jamais vers `upstream` :

```sh
BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"
```

Pas de `--force`.

## 5. Ouverture de la PR

Cible explicitement le dépôt d'`origin` pour que `gh` ne choisisse pas `upstream` :

```sh
REPO=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
gh pr create --repo "$REPO" --base main --head "$BRANCH" \
  --title "<titre du commit principal>" \
  --body "<résumé des changements + vérifications effectuées>"
```

- Titre : le sujet du commit s'il n'y en a qu'un, sinon un résumé au même format.
- Corps : liste courte des changements et des commandes de validation lancées (avec leur résultat).
- Si une PR existe déjà pour la branche (`gh pr view "$BRANCH" --repo "$REPO"`), réutilise-la.

## 6. Fermeture de la PR (merge)

```sh
gh pr merge "$BRANCH" --repo "$REPO" --squash --delete-branch
```

- Si le merge est refusé (conflits, checks requis, protection de branche), **ne force rien** :
  laisse la PR ouverte et rapporte la raison avec l'URL de la PR.
- `--delete-branch` peut échouer à supprimer la branche locale car elle est utilisée par le worktree :
  c'est sans gravité, la branche distante est supprimée quand même.
## 7. Récupération de `main` à jour

**Uniquement si la PR est bien mergée** :

```sh
gh pr view "$BRANCH" --repo "$REPO" --json state -q .state   # doit afficher MERGED
```

Si la PR est restée ouverte ou si le merge a échoué, arrête-toi ici : garde le worktree et la branche.

Sinon, récupère `main` à jour :

```sh
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
git fetch --prune origin
# Avance le checkout principal seulement s'il est sur main et propre (fast-forward uniquement)
if [ "$(git -C "$MAIN" branch --show-current)" = main ] && [ -z "$(git -C "$MAIN" status --porcelain)" ]; then
  git -C "$MAIN" pull --ff-only origin main
fi
```

Si le checkout principal n'est pas sur `main` ou contient des modifications, ne le touche pas :
le `fetch` suffit pour la suite, signale-le dans le rapport.

## 8. Nettoyage du worktree

Le merge est fait en **squash** : GitHub crée un nouveau commit sur `main`, et les commits de la branche
n'en deviennent **jamais** des ancêtres, même après le `pull`. Git (`branch -d`) et `ExitWorktree`
considéreront donc toujours la branche comme non mergée. La preuve que rien ne sera perdu est
une comparaison de contenu avec `origin/main`.

1. Vérifie qu'il ne reste rien de non commité ni de non poussé :

   ```sh
   git status --porcelain                 # doit être vide
   git log origin/main..HEAD --oneline    # liste les commits de la branche (squashés dans main)
   ```

2. Vérifie que chaque fichier touché par la branche est identique sur `origin/main` :

   ```sh
   BASE=$(git merge-base origin/main HEAD)
   git diff --quiet origin/main HEAD -- $(git diff --name-only "$BASE" HEAD) && echo IDENTIQUE
   ```

   Si la sortie n'est pas `IDENTIQUE` (fichier modifié depuis par un autre commit sur `main`, merge incomplet…),
   **ne supprime rien** : garde le worktree et rapporte les fichiers qui diffèrent (`git diff --stat origin/main HEAD -- …`).

3. Si tout est identique, supprime le worktree et sa branche locale :

   - Worktree créé dans cette session avec `EnterWorktree` : `ExitWorktree` avec `action: "remove"`.
     Il refusera en signalant des commits non mergés (à cause du squash) : relance-le avec
     `discard_changes: true`, ce qui est sûr puisque l'étape 2 a prouvé que leur contenu est sur `main`.
   - Sinon, depuis le checkout principal (jamais depuis le worktree lui-même) :

     ```sh
     WT=$(git rev-parse --show-toplevel)
     git -C "$MAIN" worktree remove "$WT"
     git -C "$MAIN" branch -D "$BRANCH"   # -D : un squash merge n'est pas vu comme mergé par git
     ```

     `git worktree remove` refuse s'il reste des fichiers modifiés ou non suivis : n'ajoute pas `--force`,
     rapporte ce qui reste et laisse l'utilisateur décider.

4. Confirme avec `git -C "$MAIN" worktree list` et `git -C "$MAIN" branch --list "$BRANCH"`.

## 9. Rapport

Termine avec :

- le(s) commit(s) créé(s) (hash court + sujet),
- l'URL de la PR et son état final (mergée/fermée, ou restée ouverte avec la raison),
- si le worktree a été supprimé ou conservé (et pourquoi),
- si le checkout principal a été avancé, ou la commande à lancer sinon : `git -C <repo> pull --ff-only origin main`.
