import { preprocessMarkdown } from '@/lib/utils/format';

// The dashboard's seek links (`[⏱ 01:23](#t=83)`) need a mounted player to do
// anything (ADR 042); the public share page has none, so show the plain timestamp.
const SEEK_LINK = /\[⏱ ([^\]]+)\]\(#t=\d+(?:\.\d+)?\)/gu;

export function toShareMarkdown(content: string): string {
  return preprocessMarkdown(content).replace(SEEK_LINK, '$1');
}
