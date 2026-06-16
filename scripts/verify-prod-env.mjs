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
import { existsSync } from 'node:fs'

const problems = []

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

if (problems.length > 0) {
  console.error('\n❌ Production environment check failed:\n')
  for (const msg of problems) {
    console.error(`  • ${msg}\n`)
  }
  process.exit(1)
}

console.log('✓ Production env OK (.env.production present, no .env.local)')