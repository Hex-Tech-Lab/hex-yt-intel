import fs from 'fs';
import path from 'path';
import { Metadata } from 'next';
import { LegalPage } from '@/components/templates/LegalPage';

export const metadata: Metadata = {
  title: 'Refund Policy | Hex YT Intel',
  description: 'Refund Policy for Hex YT Intel',
};

export default async function RefundPolicyPage() {
  const filePath = path.join(process.cwd(), '..', 'docs', 'legal', 'refund-policy.md');
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    content = '# Refund Policy\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return <LegalPage content={content} />;
}
