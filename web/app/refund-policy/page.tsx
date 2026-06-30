import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Refund Policy | Hex YT Intel',
  description: 'Refund Policy for Hex YT Intel',
};

export default async function RefundPolicyPage() {
  const docName = 'refund-policy.md';
  const docsDir = path.resolve(process.cwd(), '..', 'docs', 'legal');
  const legalDocsPath = path.resolve(docsDir, docName);

  let content = '';
  try {
    if (!legalDocsPath.startsWith(docsDir)) {
      throw new Error('Path traversal attempted');
    }
    content = fs.readFileSync(legalDocsPath, 'utf8');
  } catch (e) {
    console.debug('[refund-policy] Failed to read legal doc:', e instanceof Error ? e.message : String(e));
    content = '# Refund Policy\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
