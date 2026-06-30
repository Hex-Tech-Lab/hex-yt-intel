import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service | Hex YT Intel',
  description: 'Terms of Service for Hex YT Intel',
};

export default async function TermsAndConditionsPage() {
  const filePath = path.join(process.cwd(), '..', 'docs', 'legal', 'terms-of-service.md');
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    content = '# Terms of Service\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
