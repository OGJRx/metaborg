#!/bin/bash
echo "🔄 Sincronizando con origen 'titan'..."
git fetch --all
git reset --hard origin/titan
npm ci
echo "✅ Sincronización completada. HEAD en $(git rev-parse --short HEAD)"
