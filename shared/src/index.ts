export {
  LANGUAGES,
  getSnippet,
  isLanguage,
  listSnippets,
  pickSnippet,
} from "./snippets.js";
export type { Language, PickSnippetOptions, Snippet } from "./snippets.js";
export {
  CHARACTERS_PER_WORD,
  calculateAccuracy,
  calculateTypingStats,
  calculateWpm,
} from "./stats.js";
export type { TypingStats } from "./stats.js";
