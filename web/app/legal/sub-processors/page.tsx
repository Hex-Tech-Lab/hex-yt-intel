import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Sub-processors | Hex YT Intel',
  description: 'A complete list of third-party sub-processors used by Hex-YT Intel for data processing.',
};

export default function SubProcessorsPage() {
  const docName = 'sub-processors.md';
  const docsDir = path.resolve(process.cwd(), '..', 'docs', 'legal');
  const filePath = path.resolve(docsDir, docName);

  let content = '';
  try {
    if (!filePath.startsWith(docsDir)) {
      throw new Error('Path traversal attempted');
    }
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.debug('[sub-processors] Failed to read legal doc:', e instanceof Error ? e.message : String(e));
    content = '# Sub-processor Disclosure\n\nThis document is currently being compiled. Please check back later.';
  }

  return <LegalPage content={content} />;
}
