#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');

console.log('Creating standalone bundle...');

// Read the HTML template first to extract initialization code
const htmlTemplate = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');

// Extract the original module script content to preserve custom defaults
const moduleScriptStart = '<script type="module">';
const moduleScriptEnd = '</script>';

const startIndex = htmlTemplate.indexOf(moduleScriptStart);
const endIndex = htmlTemplate.indexOf(moduleScriptEnd, startIndex) + moduleScriptEnd.length;

if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find module script in HTML template');
    process.exit(1);
}

// Extract the original initialization code (including custom defaults)
const originalModuleScript = htmlTemplate.substring(startIndex + moduleScriptStart.length, endIndex - moduleScriptEnd.length);

// Extract everything after the import statement
const importLineEnd = originalModuleScript.indexOf('\n', originalModuleScript.indexOf('import'));
const originalInitCode = originalModuleScript.substring(importLineEnd + 1).trim();

// Read the esbuild IIFE bundle
const bundlePath = path.join(distPath, 'app-bundle.js');
let bundledJS = '';

if (fs.existsSync(bundlePath)) {
    console.log('Reading app-bundle.js...');
    bundledJS = fs.readFileSync(bundlePath, 'utf8');
    
    // Add the original initialization code (preserves custom defaults)
    bundledJS += '\n' + originalInitCode;
} else {
    console.error('Bundle file not found:', bundlePath);
    process.exit(1);
}

// Remove the import map and module script, replace with inline script
const importMapScriptStart = '<script type="importmap">';
const importMapIndex = htmlTemplate.indexOf(importMapScriptStart);
if (importMapIndex === -1) {
    console.error('Could not find import map script in HTML template');
    process.exit(1);
}
const beforeScript = htmlTemplate.substring(0, importMapIndex);
const afterScript = htmlTemplate.substring(endIndex);

const standalonePlaceholder = `    <!-- Bundled application code (includes JSZip) -->
    <script>
${bundledJS}
    </script>`;

const standaloneHTML = beforeScript + standalonePlaceholder + afterScript;

// Write the standalone HTML file
const outputPath = path.join(distPath, 'index-standalone.html');
fs.writeFileSync(outputPath, standaloneHTML);

console.log(`✅ Bundle created: ${outputPath}`);
console.log('You can now open this file directly in your browser with file:// protocol');