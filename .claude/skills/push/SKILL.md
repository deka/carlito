---
name: push
description: Commit et push le travail en cours sur la branche durable `dev` (origin), sans PR ni merge vers `main`. À utiliser quand l'utilisateur demande /push ou de « commit et push » / « pousser sur dev ».
---

# Push

Enregistre le travail en cours sur `dev` et le pousse sur `origin/dev`.
Contrairement à `/publish`, n'ouvre **aucune** PR et ne touche pas à `main` : aucune release n'est déclenchée.

L'invocation de ce skill vaut autorisation explicite de commit et de push sur `dev`.
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
  - `dev` n'existe pas encore : `git switch -c dev origin/main`.
- Si `origin/dev` a des commits absents de `dev` local : `git merge --ff-only origin/dev` si possible ;
  sinon (historiques divergents) arrête-toi et rapporte. Jamais de rebase ni de force-push.
- S'il n'y a rien à committer **et** aucun commit d'avance (`git log origin/dev..dev`), indique qu'il n'y a rien à pousser et arrête-toi.

## 2. Validation

Lance les vérifications du projet (cf. `AGENTS.md`) :

```sh
npm run typecheck
npm run lint
npm run build
```

- Changements limités au main process : `npm run typecheck:node` et `npm run lint` suffisent.
- Changements limités à la documentation ou à `.claude/` : tu peux tout sauter en le signalant.
- Si une commande échoue, **arrête-toi** : ne commit pas, ne pousse pas, rapporte l'erreur.

## 3. Commit

S'il reste des changements non commités :

- Utilise le skill `git-commit` s'il est disponible ; sinon écris un message au format Conventional Commits
  (`feat(scope): …`, `fix(scope): …`, `ci: …`, `chore: …`), cohérent avec `git log --oneline -10`.
- Chaque commit deviendra une ligne des release notes : un commit par changement distinct
  (découpe en plusieurs commits si les modifications couvrent plusieurs sujets),
  avec un sujet compréhensible par un utilisateur (pas de « wip », « fix typo », commit fourre-tout).
- N'ajoute jamais de fichiers secrets (`.env`, credentials, `.claude/settings.local.json`).
- `.claude/` est dans `.gitignore` : un fichier sous `.claude/` qui doit être versionné s'ajoute avec `git add -f`.

## 4. Push

Toujours vers `origin`, jamais vers `upstream`, jamais `--force` :

```sh
git push -u origin dev
```

Si le push est refusé (non fast-forward), refais l'étape 1 (`fetch` + `merge --ff-only origin/dev`) ; si ça ne suffit pas, arrête-toi et rapporte.

## 5. Rapport

Termine avec :

- les commits poussés (`git log --oneline` des nouveaux commits : hash court + sujet),
- les vérifications lancées et leur résultat (ou la raison pour laquelle elles ont été sautées),
- l'état de `dev` par rapport à `origin/dev` et `origin/main` (nombre de commits d'avance sur `main`),
- un rappel que `/publish` publiera ces commits sur `main` et déclenchera la release.
