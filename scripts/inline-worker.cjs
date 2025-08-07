/**
 * Build script to inline worker code into async-parser
 */

const fs = require('fs');
const path = require('path');

function inlineWorker() {
  const distDir = path.join(__dirname, '../dist');
  const workerPath = path.join(distDir, 'parser/worker.js');
  const asyncParserPath = path.join(distDir, 'parser/async-parser.js');
  
  // Read the worker code
  if (!fs.existsSync(workerPath)) {
    console.error('Worker file not found:', workerPath);
    process.exit(1);
  }
  
  let workerCode = fs.readFileSync(workerPath, 'utf8');
  
  // Remove source map reference and clean up
  workerCode = workerCode.replace(/\/\/# sourceMappingURL=.*$/m, '');
  
  // Escape the worker code for embedding in a string
  const escapedWorkerCode = workerCode
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\${/g, '\\${');
  
  // Read the async-parser code
  if (!fs.existsSync(asyncParserPath)) {
    console.error('Async parser file not found:', asyncParserPath);
    process.exit(1);
  }
  
  let asyncParserCode = fs.readFileSync(asyncParserPath, 'utf8');
  
  // Replace the placeholder with actual worker code
  const workerTemplate = `const workerCode = \`${escapedWorkerCode}\`;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob), { type: 'module' });`;
  
  // Replace the worker creation section - look for the placeholder comment
  const placeholderStart = asyncParserCode.indexOf('// PLACEHOLDER: This will be replaced by build script');
  const placeholderEnd = asyncParserCode.indexOf('this.worker.onmessage');
  
  if (placeholderStart === -1 || placeholderEnd === -1) {
    console.error('Could not find placeholder section to replace');
    process.exit(1);
  }
  
  // Find the start of the if block
  const ifStart = asyncParserCode.lastIndexOf('if (typeof window', placeholderEnd);
  
  const replacement = `// Create worker from inlined code
      try {
        ${workerTemplate}
      } catch (error) {
        console.warn('Failed to create inline worker:', error);
        this.worker = null;
        return;
      }
      
      `;
  
  asyncParserCode = asyncParserCode.substring(0, ifStart) + 
                   replacement + 
                   asyncParserCode.substring(placeholderEnd);
  
  // Write the updated async-parser code
  fs.writeFileSync(asyncParserPath, asyncParserCode);
  
  console.log('✅ Worker code inlined into async-parser.js');
  
  // Clean up - remove the separate worker file since it's now inlined
  fs.unlinkSync(workerPath);
  
  // Also remove worker declaration file
  const workerDtsPath = path.join(distDir, 'parser/worker.d.ts');
  if (fs.existsSync(workerDtsPath)) {
    fs.unlinkSync(workerDtsPath);
  }
  
  // Remove worker source map
  const workerMapPath = path.join(distDir, 'parser/worker.js.map');
  if (fs.existsSync(workerMapPath)) {
    fs.unlinkSync(workerMapPath);
  }
  
  console.log('🧹 Cleaned up separate worker files');
}

if (require.main === module) {
  inlineWorker();
}

module.exports = { inlineWorker };