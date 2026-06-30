import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service | Hex YT Intel',
  description: 'Terms of Service for Hex YT Intel',
};

export default async function TermsAndConditionsPage() {
  const docName = 'terms-of-service.md';
  const docsDir = path.resolve(process.cwd(), '..', 'docs', 'legal');
  const filePath = path.resolve(docsDir, docName);

  let content = '';
  try {
    if (!filePath.startsWith(docsDir)) {
      throw new Error('Path traversal attempted');
    }
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.debug('[terms-and-conditions] Failed to read legal doc:', e instanceof Error ? e.message : String(e));
    content = '# Terms of Service\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
