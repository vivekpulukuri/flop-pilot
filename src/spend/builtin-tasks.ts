import type { Task } from './tasks.js';

/** Small factual eval set used when the owner's task queue is empty (spec §4.4 "useful inference"). */
export const BUILTIN_TASKS: Task[] = [
  ['capital-france', 'What is the capital of France? Answer in one sentence.', ['Paris']],
  ['water-formula', 'What is the chemical formula of water?', ['H2O']],
  ['speed-light', 'Roughly how fast does light travel in a vacuum, in km per second?', ['300', '000']],
  ['largest-planet', 'Which planet in our solar system is the largest?', ['Jupiter']],
  ['photosynthesis', 'In one sentence, what gas do plants absorb during photosynthesis?', ['carbon dioxide']],
  ['binary-ten', 'Write the number 10 in binary.', ['1010']],
  ['shakespeare', 'Who wrote the play "Romeo and Juliet"?', ['Shakespeare']],
  ['boiling-point', 'At sea level, what is the boiling point of water in Celsius?', ['100']],
  ['dna', 'What does DNA stand for?', ['deoxyribonucleic']],
  ['prime-check', 'Is 97 a prime number? Answer yes or no and explain briefly.', ['yes']],
  ['continents', 'How many continents are there on Earth by the most common count?', ['seven', '7']],
  ['http-status', 'What does HTTP status code 404 mean?', ['not found']],
  ['moon-landing', 'In what year did humans first land on the Moon?', ['1969']],
  ['sqrt-144', 'What is the square root of 144?', ['12']],
  ['ocean-largest', 'What is the largest ocean on Earth?', ['Pacific']],
  ['author-1984', 'Who wrote the novel "1984"?', ['Orwell']],
  ['hexagon-sides', 'How many sides does a hexagon have?', ['six', '6']],
  ['freezing-f', 'What is the freezing point of water in Fahrenheit?', ['32']],
  ['blockchain-def', 'In one sentence, what is a blockchain?', ['ledger']],
  ['planet-red', 'Which planet is known as the Red Planet?', ['Mars']],
].map(([id, prompt, expectKeywords]) => ({ id: `builtin:${id}`, prompt: prompt as string, expectKeywords: expectKeywords as string[], source: 'builtin' as const }));
