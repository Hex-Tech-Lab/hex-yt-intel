import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Refund Policy | Hex YT Intel',
  description: 'Refund Policy for Hex YT Intel',
};

/**
 * Renders the refund policy page by reading the corresponding markdown file from the docs directory.
 * If the file cannot be read (e.g., due to path issues), it displays a placeholder message.
 * @returns {JSX.Element} The LegalPage component with the refund policy content.
 */
export default async function RefundPolicyPage() {
  const docName = 'refund-policy.md';
  const cwdParts = process.cwd().split(path.sep);
  const baseDir = cwdParts.slice(0, -1).join(path.sep);
  const docsDir = path.join(baseDir, 'docs', 'legal');
  const legalDocsPath = path.join(docsDir, docName);
  const realDocsDir = path.resolve(docsDir);
  const realPath = path.resolve(legalDocsPath);

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    content = '# Refund Policy\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
