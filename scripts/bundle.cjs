#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the compiled JavaScript files in dependency order
const distPath = path.join(__dirname, '..', 'dist');

const files = [
    'parser/types.js',
    'parser/parser.js',
    'app/types.js', 
    'app/AppState.js',
    'app/SettingsManager.js',
    'app/ProfileCollection.js',
    'ui/StackTraceApp.js'
];

console.log('Bundling JavaScript files...');

let bundledJS = '';
bundledJS += '// Bundled JavaScript - Generated automatically\n\n';

// Read each file and remove import/export statements
files.forEach(file => {
    const filePath = path.join(distPath, file);
    if (fs.existsSync(filePath)) {
        console.log(`Reading ${file}...`);
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Handle JSZip import specially - both old and new CDN imports
        if (content.includes('import JSZip from \'jszip\';')) {
            content = content.replace(/import JSZip from \'jszip\';/g, '// JSZip will be loaded from CDN');
        }
        if (content.includes('import JSZip from \'https://cdn.skypack.dev/jszip')) {
            content = content.replace(/import JSZip from \'https:\/\/cdn\.skypack\.dev\/jszip[^']*\';/g, '// JSZip will be loaded from CDN');
        }
        
        // Remove all import statements
        content = content.replace(/^import\s+.*?;$/gm, '');
        
        // Remove all export statements (make classes global)
        content = content.replace(/^export\s+.*?;$/gm, '');
        content = content.replace(/^export\s+\{[^}]*\}[^;]*;$/gm, '');
        content = content.replace(/^export\s+\*[^;]*;$/gm, '');
        content = content.replace(/^export\s+/gm, '');
        
        // Remove source map comments
        content = content.replace(/\/\/# sourceMappingURL=.*$/gm, '');
        
        // Clean up extra whitespace
        content = content.trim();
        
        if (content) {
            bundledJS += `// === ${file} ===\n`;
            bundledJS += content + '\n\n';
        }
    } else {
        console.warn(`Warning: ${file} not found`);
    }
});

// Add initialization code
bundledJS += `
// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new StackTraceApp();
    window.app = app;
    console.log('Go Stack Trace Viewer loaded');
});
`;

// Read the HTML template
const htmlTemplate = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Replace the module script with JSZip CDN + bundled script
// Use exact string matching to avoid corrupting JavaScript regex patterns
const moduleScriptStart = '<script type="module">';
const moduleScriptEnd = '</script>';
const moduleScriptStartIndex = htmlTemplate.indexOf(moduleScriptStart);
const moduleScriptEndIndex = htmlTemplate.indexOf(moduleScriptEnd, moduleScriptStartIndex) + moduleScriptEnd.length;

if (moduleScriptStartIndex === -1 || moduleScriptEndIndex === -1) {
    throw new Error('Could not find module script to replace in HTML template');
}

const bundledHTML = htmlTemplate.substring(0, moduleScriptStartIndex) +
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script>
${bundledJS}
    </script>` +
    htmlTemplate.substring(moduleScriptEndIndex);

// Write the standalone HTML file
const outputPath = path.join(__dirname, '..', 'dist', 'index-standalone.html');
fs.writeFileSync(outputPath, bundledHTML);

console.log(`✅ Bundle created: ${outputPath}`);
console.log('You can now open this file directly in your browser with file:// protocol');