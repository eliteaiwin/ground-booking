// @capacitor-community/apple-sign-in pins capacitor-swift-pm to 7.x in its
// Package.swift, which cannot resolve alongside the app's Capacitor 8 pin.
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules',
  '@capacitor-community',
  'apple-sign-in',
  'Package.swift'
);

if (!fs.existsSync(file)) process.exit(0);

const src = fs.readFileSync(file, 'utf8');
const patched = src.replace(
  /capacitor-swift-pm\.git",\s*from:\s*"7\.0\.0"/,
  'capacitor-swift-pm.git", from: "8.0.0"'
);
if (patched !== src) {
  fs.writeFileSync(file, patched);
  console.log('Patched apple-sign-in Package.swift for Capacitor 8');
}
