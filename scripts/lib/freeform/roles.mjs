// Caption emphasis roles: what a word IS decides how it is styled, so captions stop being one treatment for every word.
//
//   number    a figure or number word        accent colour + a small pulse as it is said
//   negation  not, never, can't, without...  bold uppercase + a short shake
//   name      an acronym or proper name      an accent underline that sweeps under it
//
// Opt in from the spec:  roles: "auto"  (all three)  or  roles: { numbers: true, negations: true, names: true | [word] }
// `names` as a list adds explicit words to the detected ones. A word the spec already marks (spec.marks) or
// makes a hero keeps that styling; roles only fill in words nobody styled. Roles apply to caption stacks only:
// takeover and punch scenes have their own treatments.
import { norm } from "../../../style-library/03-kinetic-serif/kinetic.mjs";

export const ROLE_NAMES = Object.freeze(["number", "negation", "name"]);

const NUMBER_WORDS = new Set(("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " +
  "seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion percent dozen").split(" "));
const NEGATIONS = new Set(("not no never none nothing nobody nowhere neither nor without cannot " +
  "can't won't don't doesn't didn't isn't aren't wasn't weren't wouldn't shouldn't couldn't hasn't haven't hadn't ain't").split(" "));
const NOT_NAMES = new Set(["i", "i'm", "i'll", "i've", "i'd"]);
const SENTENCE_END = /[.?!]["')\]]*$/;

const stripEdges = (t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
// Typographic apostrophes from a transcript must match the plain ones above.
const plain = (t) => norm(t.replace(/[‘’]/g, "'")).replace(/^-+|-+$/g, "");

const TENS = new Set("twenty thirty forty fifty sixty seventy eighty ninety".split(" "));
const SCALES = new Set("hundred thousand million billion trillion percent dozen".split(" "));
/** `one` is usually a pronoun ("another one"), so it counts only inside a quantity: "one hundred", "twenty one", "one percent". */
export function isNumber(text, previous, next) {
  if (/\d/.test(text)) return true;
  const word = plain(text);
  if (word !== "one") return NUMBER_WORDS.has(word);
  return (!!next && SCALES.has(plain(next.text))) || (!!previous && TENS.has(plain(previous.text)));
}
export const isNegation = (text) => NEGATIONS.has(plain(text));
/** An acronym (EMR, API), a CamelCase product (ClickUp) or a capitalised word in the middle of a sentence. */
export function isName(text, previous) {
  const t = stripEdges(text);
  if (t.length < 2 || NOT_NAMES.has(t.toLowerCase())) return false;
  if (/^[A-Z]{2,}s?$/.test(t) || /^[A-Z][a-z]+[A-Z][A-Za-z]*$/.test(t)) return true;
  return /^[A-Z][a-z]+$/.test(t) && !!previous && !SENTENCE_END.test(previous.text);
}

/** Normalise `spec.roles` into { numbers, negations, names, extraNames } (all off when unset). */
export function resolveRoles(roles) {
  if (!roles) return { numbers: false, negations: false, names: false, extraNames: [] };
  if (roles === "auto") return { numbers: true, negations: true, names: true, extraNames: [] };
  const names = roles.names;
  return { numbers: roles.numbers !== false, negations: roles.negations !== false, names: names !== false, extraNames: Array.isArray(names) ? names : [] };
}

export function validateRoles(roles, inWords) {
  if (roles === undefined || roles === false || roles === "auto") return;
  const bad = (why) => { throw new Error(`freeform: roles ${why}; use "auto" or { ${["numbers", "negations", "names"].join(", ")} }`); };
  if (typeof roles !== "object" || Array.isArray(roles)) bad(`must be "auto" or an object, got ${JSON.stringify(roles)}`);
  for (const key of Object.keys(roles)) if (!["numbers", "negations", "names"].includes(key)) bad(`has an unknown key "${key}"`);
  for (const key of ["numbers", "negations"]) if (roles[key] !== undefined && typeof roles[key] !== "boolean") bad(`.${key} must be true or false`);
  if (roles.names !== undefined && typeof roles.names !== "boolean" && !(Array.isArray(roles.names) && roles.names.every(inWords))) bad(".names must be true, false or a list of words from ctx.find");
}

/** Map of word -> "number" | "negation" | "name" for the words nobody styled explicitly. */
export function classifyWords(words, roles, styled = new Set()) {
  const r = resolveRoles(roles);
  const explicit = new Set(r.extraNames);
  const out = new Map();
  words.forEach((word, i) => {
    if (styled.has(word)) return;
    if (r.negations && isNegation(word.text)) out.set(word, "negation");
    else if (r.numbers && isNumber(word.text, words[i - 1], words[i + 1])) out.set(word, "number");
    else if (explicit.has(word) || (r.names && isName(word.text, words[i - 1]))) out.set(word, "name");
  });
  return out;
}
