import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import * as Sentry from '@sentry/nextjs';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | Hex YT Intel',
  description: 'Privacy Policy for Hex YT Intel',
};

/**
 * Renders the privacy policy page by loading and displaying the privacy policy document.
 *
 * @returns {JSX.Element} The Privacy Policy page component.
 */
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
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[privacy-policy] Failed to read legal doc:', { error: errorMsg, filePath: realPath });
    Sentry.captureException(e, {
      tags: { operation: 'legal-page-render', page: 'privacy-policy' },
      contexts: { file: { path: realPath, docName } }
    });
    content = '# Privacy Policy\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
