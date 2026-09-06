#!/usr/bin/env bash
# release.sh - Publica una release de Keynest con la serie canonica v1.x.
#
# Uso:   ./scripts/release.sh [patch|minor|major] [--push]
#
# Flujo (mecaniza la parte que antes se hacia a mano y se equivocaba):
#   1. Valida: rama main, working tree limpio y al dia con origin/main.
#   2. Calcula la siguiente version a partir del ultimo tag v* (SemVer).
#   3. Exige que CHANGELOG.md ya tenga la seccion "[X.Y.Z]" (la redactas
#      antes, como hasta ahora, en el idioma y estilo del changelog).
#   4. Bumpea app/package.json y server/package.json a esa version.
#   5. Commit "chore(release): vX.Y.Z" + tag vX.Y.Z (local, sin push salvo
#      --push). El workflow release.yml publica la release con los assets.
#
# El tipo por defecto es patch; usa minor para features y major para cambios
# incompatibles. Con --push hace push de main y del tag.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

tipo="${1:-patch}"
case "$tipo" in
  patch|minor|major) ;;
  *) echo "uso: $0 [patch|minor|major] [--push]" >&2; exit 1 ;;
esac
PUSH=0
[ "${2:-}" = "--push" ] && PUSH=1

# --- 1. Contexto de git ------------------------------------------------------
rama=$(git branch --show-current)
[ "$rama" = "main" ] || { echo "ERROR: no estas en main (estas en $rama)" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "ERROR: working tree sucio (haz commit o stash)" >&2; exit 1; }
git fetch origin main >/dev/null 2>&1 || { echo "ERROR: no se pudo hacer fetch de origin/main" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || { echo "ERROR: main local no esta al dia con origin/main" >&2; exit 1; }

# --- 2. Version siguiente -----------------------------------------------------
ultimo=$(git tag --list 'v*' --sort=-v:refname | head -1)
[ -n "$ultimo" ] || { echo "ERROR: no hay ningun tag v*" >&2; exit 1; }
cur="${ultimo#v}"
IFS=. read -r ma mi pa <<< "$cur"
case "$tipo" in
  patch) pa=$((pa + 1)) ;;
  minor) pa=0; mi=$((mi + 1)) ;;
  major) pa=0; mi=0; ma=$((ma + 1)) ;;
esac
nueva="$ma.$mi.$pa"
tag="v$nueva"
[ -z "$(git tag --list "$tag")" ] || { echo "ERROR: el tag $tag ya existe" >&2; exit 1; }
echo "Ultima release: $cur  ->  nueva: $nueva"

# --- 3. CHANGELOG con la seccion de la version --------------------------------
grep -q "^## \[$nueva\]" CHANGELOG.md \
  || { echo "ERROR: CHANGELOG.md no tiene la seccion [$nueva]. Redactala antes de lanzar el release." >&2; exit 1; }

# --- 4. Bump de version --------------------------------------------------------
python3 - "$nueva" <<'EOF'
import json, sys
v = sys.argv[1]
for p in ('app/package.json', 'server/package.json'):
    with open(p) as f:
        d = json.load(f)
    d['version'] = v
    with open(p, 'w') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
        f.write('\n')
EOF

# --- 5. Commit + tag -----------------------------------------------------------
git add app/package.json server/package.json CHANGELOG.md
git commit -m "chore(release): $tag"
git tag "$tag"
echo "Release $tag creada (commit + tag locales)."

if [ "$PUSH" = 1 ]; then
  git push origin main
  git push origin "$tag"
  echo "Pusheado. El workflow release.yml publica la release."
else
  echo "Para publicar: git push origin main && git push origin $tag"
fi
