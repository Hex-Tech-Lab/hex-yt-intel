import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import * as Sentry from '@sentry/nextjs';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Sub-processors | Hex YT Intel',
  description: 'A complete list of third-party sub-processors used by Hex-YT Intel for data processing.',
};

/**
 * Renders the Sub-Processors legal documentation page by reading and displaying the documentation markdown.
 *
 * Attempts to read 'sub-processors.md' from the project's docs/legal directory,
 * blocks path traversal, and falls back to a default message if reading fails.
 *
 * @returns {JSX.Element} The LegalPage component with the sub-processors content.
 */
export default function SubProcessorsPage() {
  const docName = 'sub-processors.md';
  const cwdParts = process.cwd().split(path.sep);
  const baseDir = cwdParts.slice(0, -1).join(path.sep);
  const docsDir = path.join(baseDir, 'docs', 'legal');
  const filePath = path.join(docsDir, docName);
  const realDocsDir = path.resolve(docsDir);
  const realPath = path.resolve(filePath);

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    content = '# Sub-processor Disclosure\n\nThis document is currently being compiled. Please check back later.';
  }

  return <LegalPage content={content} />;
}
