/**
 * generate-followup-prompts.ts
 *
 * Generates three context-aware follow-up prompts after an assistant response.
 * Each prompt follows one of three archetypes:
 * 1. Elaboration (deep-dive on the topic)
 * 2. Contextualization (connect to broader framework/implications)
 * 3. Forward-Thinking (next logical angles or implications)
 *
 * Prompts are smart, non-generic, and directly relate to the message content.
 */

export interface FollowupContext {
  userQuestion: string;
  assistantResponse: string;
  videoTitle?: string;
  analysisContext?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Extract key entities/topics from text using simple heuristics.
 * Looks for capitalized phrases, quoted strings, and numbered items.
 */
function extractKeyTopics(text: string): string[] {
  const topics: Set<string> = new Set();

  // Extract quoted phrases
  const quoted = text.match(/"([^"]+)"/g);
  if (quoted) {
    quoted.forEach((q) => {
      const clean = q.slice(1, -1).trim();
      if (clean.length > 3 && clean.length < 100) topics.add(clean);
    });
  }

  // Extract capitalized phrases (likely proper nouns or concepts)
  const capitalized = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g);
  if (capitalized) {
    capitalized
      .filter((phrase) => phrase.length > 3 && phrase.length < 80)
      .slice(0, 5)
      .forEach((phrase) => topics.add(phrase));
  }

  // Extract numbered dimensions or items
  const numbered = text.match(/(?:dimension|aspect|point|reason|factor|step)\s+(\d+)[:\s]+([^\n.]+)/gi);
  if (numbered) {
    numbered
      .slice(0, 3)
      .forEach((item) => {
        const match = item.match(/:\s*(.+?)(?:\.|$)/);
        if (match && match[1]) {
          const extracted = match[1].trim().slice(0, 60);
          if (extracted.length > 3) topics.add(extracted);
        }
      });
  }

  return Array.from(topics).slice(0, 5);
}

/**
 * Detect question type from user input and response.
 * Returns one of: 'what', 'why', 'how', 'when', 'where', 'who', 'compare', 'evaluate', 'predict'
 */
function detectQuestionType(userQuestion: string): string {
  const lower = userQuestion.toLowerCase().trim();

  if (/^(how|what\s+is|explain|describe|tell me about)/i.test(lower)) return 'what';
  if (/^why|reason|cause|motivat/i.test(lower)) return 'why';
  if (/^how\s+(to|do|would|can)/i.test(lower)) return 'how';
  if (/^(when|at what time|during)/i.test(lower)) return 'when';
  if (/^(where|location|position|place)/i.test(lower)) return 'where';
  if (/^(who|which person|character|creator)/i.test(lower)) return 'who';
  if (/(compare|contrast|difference|similar|versus|vs\.|vs)/i.test(lower)) return 'compare';
  if (/(evaluate|assess|critique|opinion|good|bad|effective)/i.test(lower)) return 'evaluate';
  if (/(predict|forecast|future|will|happen next|implications)/i.test(lower)) return 'predict';

  return 'what';
}

/**
 * Generate an elaboration prompt (deep-dive follow-up).
 * Focuses on expanding the concept or diving into specifics.
 */
function generateElaborationPrompt(
  _userQuestion: string,
  _assistantResponse: string,
  keyTopics: string[],
  questionType: string
): string {
  const topic = keyTopics[0] || 'this topic';

  const elaborationPatterns: Record<string, string[]> = {
    what: [
      `Can you elaborate on the mechanics of ${topic}?`,
      `What are the key components or layers within ${topic}?`,
      `How does ${topic} break down in more technical detail?`,
    ],
    why: [
      `What are the underlying reasons behind why ${topic} matters?`,
      `Can you explore the root causes leading to ${topic}?`,
      `What's the deeper logic or philosophy behind ${topic}?`,
    ],
    how: [
      `What are the step-by-step specifics of how ${topic} works?`,
      `Can you detail the process or methodology of ${topic}?`,
      `What are the technical details of implementing ${topic}?`,
    ],
    when: [
      `When does ${topic} typically occur or apply?`,
      `What are the specific conditions that trigger ${topic}?`,
      `Can you detail the timeline or sequence for ${topic}?`,
    ],
    where: [
      `Where does ${topic} appear or have the most impact?`,
      `In what contexts or environments is ${topic} most relevant?`,
      `Can you map out where ${topic} fits in the broader landscape?`,
    ],
    who: [
      `Who are the key figures or entities involved in ${topic}?`,
      `Can you detail the different perspectives on ${topic}?`,
      `Who benefits or is affected by ${topic}?`,
    ],
    compare: [
      `How does ${topic} contrast with alternatives or counterparts?`,
      `What makes ${topic} distinctly different from similar approaches?`,
      `Can you compare the trade-offs within ${topic}?`,
    ],
    evaluate: [
      `What are the strengths and weaknesses of ${topic}?`,
      `Can you evaluate the effectiveness or value of ${topic}?`,
      `What criteria would you use to assess ${topic}?`,
    ],
    predict: [
      `What are the potential consequences or ripple effects of ${topic}?`,
      `How might ${topic} evolve or develop further?`,
      `What does ${topic} suggest about future directions?`,
    ],
  };

  const patterns = (elaborationPatterns[questionType] || elaborationPatterns.what) as string[];
  return patterns[Math.floor(Math.random() * patterns.length)] ?? '';
}

/**
 * Generate a contextualization prompt (connect to broader framework).
 * Links the answer to related concepts or frameworks.
 */
function generateContextualizationPrompt(
  _userQuestion: string,
  _assistantResponse: string,
  keyTopics: string[],
  videoTitle?: string
): string {
  const topic = keyTopics[0] || 'this topic';
  const videoRef = videoTitle ? `in "${videoTitle.slice(0, 40)}"` : 'in this context';

  const patterns = [
    `How does ${topic} fit into the broader narrative or framework ${videoRef}?`,
    `What's the relationship between ${topic} and the overall analysis?`,
    `Can you connect ${topic} to the larger themes or patterns?`,
    `How does ${topic} relate to other dimensions or aspects discussed?`,
    `What's the systemic impact or role of ${topic} in this context?`,
    `How does ${topic} connect to the core message or thesis?`,
    `Can you contextualize ${topic} within the bigger picture?`,
    `What's the significance of ${topic} in relation to the whole?`,
  ];

  return patterns[Math.floor(Math.random() * patterns.length)] || '';
}

/**
 * Generate a forward-thinking prompt (next implications/angles).
 * Explores future directions, implications, or unexplored angles.
 */
function generateForwardThinkingPrompt(
  _userQuestion: string,
  _assistantResponse: string,
  keyTopics: string[]
): string {
  const topic = keyTopics[0] || 'this topic';

  const patterns = [
    `What are the next logical implications if ${topic} continues on this trajectory?`,
    `What angles or follow-ups would deepen understanding of ${topic}?`,
    `How might our interpretation of ${topic} change with new information?`,
    `What questions does ${topic} leave open for further exploration?`,
    `What would be the next level or evolution of ${topic}?`,
    `What unexpected angles or perspectives could challenge this view of ${topic}?`,
    `What's the longer-term significance or ripple effect of ${topic}?`,
    `How would applying this understanding of ${topic} change our perspective?`,
  ];

  return patterns[Math.floor(Math.random() * patterns.length)] || '';
}

/**
 * Main function: generate three contextual follow-up prompts.
 *
 * Returns an array of three strings, each representing a smart follow-up question
 * that elaborates on different aspects of the assistant's response.
 */
export function generateFollowupPrompts(context: FollowupContext): string[] {
  const { userQuestion, assistantResponse } = context;

  // Extract key topics from the response
  const keyTopics = extractKeyTopics(assistantResponse);

  // If no topics were extracted, fall back to generic patterns
  if (keyTopics.length === 0) {
    return [
      'Can you elaborate on the key points you mentioned?',
      'How does this connect to the broader context?',
      'What would be the next step or implication of this?',
    ];
  }

  // Detect the type of question being asked
  const questionType = detectQuestionType(userQuestion);

  // Generate one prompt from each archetype
  const elaboration = generateElaborationPrompt(userQuestion, assistantResponse, keyTopics, questionType);
  const contextualization = generateContextualizationPrompt(
    userQuestion,
    assistantResponse,
    keyTopics,
    context.videoTitle
  );
  const forwardThinking = generateForwardThinkingPrompt(userQuestion, assistantResponse, keyTopics);

  return [elaboration, contextualization, forwardThinking];
}
