// T21: detects a creative-writing chat request (owner: blog, LinkedIn, script,
// post...) so it can be routed to the writing cascade. Needs both a writing
// verb and a format word, so "what did the blog section say?" stays on chat.
const WRITING_VERB = /\b(write|rewrite|draft|compose|create|turn (?:this|it|the)\b[\w\s-]{0,30}?\binto|make (?:me )?(?:a|an))\b/iu;
const WRITING_FORMAT = /\b(blog|article|linkedin|post|tweet|thread|x post|script|newsletter|email|caption|hook|outline|essay|summary for|press release|ad copy|landing page copy)\b/iu;

export function isWritingRequest(message: string): boolean {
  return WRITING_VERB.test(message) && WRITING_FORMAT.test(message);
}
