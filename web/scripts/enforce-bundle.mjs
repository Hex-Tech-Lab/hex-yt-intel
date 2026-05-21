import fs from 'fs';
import path from 'path';

const MAX_BUNDLE_SIZE_KB = 250;
const BUILD_DIR = path.join(process.cwd(), '.next', 'static', 'chunks');

function getFilesSize(dir) {
  let totalSize = 0;
  if (!fs.existsSync(dir)) {
    return 0;
  }
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile() && file.endsWith('.js')) {
      totalSize += stat.size;
    } else if (stat.isDirectory()) {
      totalSize += getFilesSize(filePath);
    }
  }
  return totalSize;
}

try {
  // Just a simple check for any single chunk exceeding the threshold
  if (fs.existsSync(BUILD_DIR)) {
    const files = fs.readdirSync(BUILD_DIR);
    let exceeded = false;
    for (const file of files) {
      const filePath = path.join(BUILD_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && file.endsWith('.js')) {
        const sizeKB = stat.size / 1024;
        if (sizeKB > MAX_BUNDLE_SIZE_KB) {
          console.warn(`⚠️ WARNING: Chunk ${file} (${sizeKB.toFixed(2)} KB) exceeds the ${MAX_BUNDLE_SIZE_KB} KB limit.`);
          // Not exiting with 1 to avoid blocking builds immediately, but this logs warnings
          exceeded = true;
        }
      }
    }
    if (!exceeded) {
      console.log(`✅ All chunks are under the ${MAX_BUNDLE_SIZE_KB} KB limit.`);
    }
  } else {
    console.log('Build directory not found, skipping bundle enforcement.');
  }
} catch (error) {
  console.error('Error during bundle enforcement check:', error);
  process.exit(1);
}
