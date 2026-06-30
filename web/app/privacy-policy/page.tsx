import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | Hex YT Intel',
  description: 'Privacy Policy for Hex YT Intel',
};

export default async function PrivacyPolicyPage() {
  const docName = 'privacy-policy.md';
  const cwdParts = process.cwd().split(path.sep);
  const baseDir = cwdParts.slice(0, -1).join(path.sep);
  const docsDir = path.join(baseDir, 'docs', 'legal');
  const legalDocsPath = path.join(docsDir, docName);
  const realDocsDir = path.resolve(docsDir);
  const realPath = path.resolve(legalDocsPath);

  let content = '';
  try {
    if (!realPath.startsWith(realDocsDir + path.sep) && realPath !== realDocsDir) {
      throw new Error('Path traversal blocked');
    }
    content = fs.readFileSync(realPath, 'utf8');
  } catch (e) {
    console.debug('[privacy-policy] Failed to read legal doc:', e instanceof Error ? e.message : String(e));
    content = '# Privacy Policy\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
