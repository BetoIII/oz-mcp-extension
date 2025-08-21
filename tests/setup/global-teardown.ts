// tests/setup/global-teardown.ts
// Global teardown for Playwright tests

import { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function globalTeardown(config: FullConfig) {
  console.log('Cleaning up after OZ Extension E2E tests...');
  
  // Clean up test artifacts
  const testResultsDir = path.resolve(__dirname, '../../test-results');
  
  try {
    // Generate test summary
    const resultsFile = path.join(testResultsDir, 'results.json');
    if (fs.existsSync(resultsFile)) {
      const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
      
      console.log('\nTest Summary:');
      console.log(`├── Total: ${results.stats?.total || 0} tests`);
      console.log(`├── Passed: ${results.stats?.expected || 0}`);
      console.log(`├── Failed: ${results.stats?.unexpected || 0}`);
      console.log(`├── Skipped: ${results.stats?.skipped || 0}`);
      console.log(`└── Duration: ${Math.round((results.stats?.duration || 0) / 1000)}s`);
      
      if (results.stats?.unexpected > 0) {
        console.log('\n⚠️  Some tests failed. Check the HTML report for details.');
      } else {
        console.log('\n✅ All tests passed!');
      }
    }
    
    // Archive old test results if they exist
    if (fs.existsSync(testResultsDir)) {
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const archiveDir = path.join(testResultsDir, `archive-${timestamp}`);
      
      // Keep only recent archives (last 5)
      const archives = fs.readdirSync(testResultsDir)
        .filter(name => name.startsWith('archive-'))
        .sort()
        .reverse();
        
      if (archives.length >= 5) {
        for (const oldArchive of archives.slice(4)) {
          fs.rmSync(path.join(testResultsDir, oldArchive), { recursive: true, force: true });
        }
      }
    }
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  
  console.log('Global teardown complete');
}

export default globalTeardown;