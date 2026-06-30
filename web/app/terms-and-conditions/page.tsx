import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service | Hex YT Intel',
  description: 'Terms of Service for Hex YT Intel',
};

/**
 * TermsAndConditionsPage component loads and displays the Terms of Service document.
 *
 * @returns {JSX.Element} The rendered LegalPage with the terms content.
 */
export default async function TermsAndConditionsPage() {
  const docName = 'terms-of-service.md';
  const cwdParts = process.cwd().split(path.sep);
  const baseDir = cwdParts.slice(0, -1).join(path.sep);
  const docsDir = path.join(baseDir, 'docs', 'legal');
  const filePath = path.join(docsDir, docName);
  const realDocsDir = path.resolve(docsDir);
  const realPath = path.resolve(filePath);

  let content = '';
  try {
    if (!realPath.startsWith(realDocsDir + path.sep) && realPath !== realDocsDir) {
      throw new Error('Path traversal blocked');
    }
    content = fs.readFileSync(realPath, 'utf8');
  } catch (e) {
    console.debug('[terms-and-conditions] Failed to read legal doc:', e instanceof Error ? e.message : String(e));
    content = '# Terms of Service\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
