---
name: publish
description: Publie le travail terminé d'un worktree — commit, push de la branche, ouverture d'une PR sur origin puis merge (squash) qui ferme la PR. À utiliser quand l'utilisateur demande /publish ou de « publier » le travail d'un worktree.
---

# Publish

Publie le travail d'un worktree Carlo en une seule passe :
commit → push de la branche → ouverture de la PR → merge (ce qui ferme la PR).

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
- Ne modifie pas le checkout principal de l'utilisateur (pas de `checkout`/`pull` sur `main` hors du worktree) ;
  un simple `git fetch origin` suffit.

## 7. Rapport

Termine avec :

- le(s) commit(s) créé(s) (hash court + sujet),
- l'URL de la PR et son état final (mergée/fermée, ou restée ouverte avec la raison),
- la commande pour mettre à jour le checkout principal si besoin : `git -C <repo> pull origin main`.
