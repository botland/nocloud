#!/usr/bin/env node
/**
 * Guard for production build/deploy on servers.
 *
 * Next.js always loads `.env.local` in production (build + start), after
 * `.env.production`, so local dev secrets can accidentally override live config.
 *
 * Dev-only overrides belong in `.env.development.local` (loaded only by `next dev`).
 * Production secrets belong in `.env.production` (or `.env.production.local` on the server).
 */
import { existsSync, readFileSync } from 'node:fs'

const problems = []

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const vars = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    vars[key] = val
  }
  return vars
}

if (existsSync('.env.local')) {
  problems.push(
    '.env.local is present — Next.js will load it for `next build` and `next start`, overriding .env.production.\n' +
      '  • Local dev: move overrides to .env.development.local (not loaded in production).\n' +
      '  • Deploy server: remove .env.local; keep live secrets in .env.production only.',
  )
}

if (!existsSync('.env.production')) {
  problems.push(
    '.env.production is missing — create it on the server with production Stripe keys, RESEND, NEXT_PUBLIC_SITE_URL, etc.',
  )
}

const prodEnv = readEnvFile('.env.production')
const commerceMode = prodEnv.NEXT_PUBLIC_COMMERCE_MODE || 'preorder'
if (commerceMode === 'preorder' && !prodEnv.ADMIN_API_KEY) {
  problems.push(
    'ADMIN_API_KEY is missing in .env.production — required for POST /api/preorder/fulfill when NEXT_PUBLIC_COMMERCE_MODE=preorder.',
  )
}

if (problems.length > 0) {
  console.error('\n❌ Production environment check failed:\n')
  for (const msg of problems) {
    console.error(`  • ${msg}\n`)
  }
  process.exit(1)
}

console.log('✓ Production env OK (.env.production present, no .env.local)')