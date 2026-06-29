#!/usr/bin/env bash
set -e

TAG="$1"

if [ -z "$TAG" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.42.9"
  echo "Example: $0 v0.42.9"
  exit 1
fi

if [[ "$TAG" != v* ]]; then
  TAG="v$TAG"
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid tag: $TAG"
  echo "Expected format: v0.42.9"
  exit 1
fi

VERSION="${TAG#v}"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"

if [ "$VERSION" != "$PACKAGE_VERSION" ]; then
  echo "Version mismatch:"
  echo "  tag:          $VERSION"
  echo "  package.json: $PACKAGE_VERSION"
  echo "Update package.json/package-lock.json first, then retry."
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag already exists locally: $TAG"
  exit 1
fi

echo "==> Creating tag: $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo "==> Pushing tag: $TAG"
git push origin "$TAG"

echo "==> Done. The GitHub Actions workflow should trigger."