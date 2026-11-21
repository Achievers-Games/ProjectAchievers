import { Prisma } from '#prisma';

export function exactGameName(name: Prisma.Sql, query: string) {
  return Prisma.sql`strpos(lower(${name}), lower(${query})) > 0`;
}

/** Une faute d'une lettre ou une inversion est tolérée à partir de cinq caractères. */
export function matchesGameName(name: Prisma.Sql, query: string) {
  const exact = exactGameName(name, query);
  const letters = [...query];
  if (letters.length < 5) return exact;
  const similar = Prisma.sql`word_similarity(lower(${query}), lower(${name})) >= 0.6`;
  if (!/^[\p{L}\p{N}]+$/u.test(query) || letters.length > 80) {
    return Prisma.sql`(${exact} OR ${similar})`;
  }
  const swaps = letters
    .slice(1)
    .map((letter, i) =>
      [...letters.slice(0, i), letter, letters[i], ...letters.slice(i + 2)].join('').toLowerCase(),
    );
  return Prisma.sql`(${exact} OR ${similar} OR EXISTS (
    SELECT 1 FROM regexp_split_to_table(lower(${name}), '[^[:alnum:]]+') AS word
    WHERE word IN (${Prisma.join(swaps)})
       OR levenshtein_less_equal(left(word, 255), lower(${query}), 1) <= 1
  ))`;
}
