#!/usr/bin/env node
// Build guard for Netlify (ADR-0009): Netlify hosts non-production only.
// Fails the build when DH_ENV is "production" or missing, so a misconfigured
// context can never ship a production build there.
const value = process.env.DH_ENV;
if (value === 'production') {
  console.error('DH_ENV=production is not allowed on Netlify (ADR-0009). Build stopped.');
  process.exit(1);
}
if (!value) {
  console.error('DH_ENV is not set. Netlify builds must set a non-production DH_ENV (ADR-0009).');
  process.exit(1);
}
console.log(`assert-non-production: DH_ENV=${value} (non-production).`);
