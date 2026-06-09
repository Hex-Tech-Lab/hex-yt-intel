import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Sub-processors | Hex YT Intel',
  description: 'A complete list of third-party sub-processors used by Hex-YT Intel for data processing.',
};

export default function SubProcessorsPage() {
  const filePath = path.join(process.cwd(), '..', 'docs', 'legal', 'sub-processors.md');
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    content = '# Sub-processor Disclosure\n\nThis document is currently being compiled. Please check back later.';
  }

  return <LegalPage content={content} />;
}
