/**
 * Calculates the similarity score between participant A and participant B.
 * Takes the weighted fraction of matching answers.
 */
export function calculatePairwiseSimilarity(
  vectorA: (string | null)[],
  vectorB: (string | null)[],
  weights: number[] = [1.0, 1.0, 1.0, 1.0, 1.0]
): number {
  let matchSum = 0;
  let weightSum = 0;

  for (let i = 0; i < 5; i++) {
    const w = weights[i] ?? 1.0;
    weightSum += w;

    // A match is only recorded if answers are non-null and identical
    if (
      vectorA[i] !== null &&
      vectorB[i] !== null &&
      vectorA[i] !== undefined &&
      vectorB[i] !== undefined &&
      vectorA[i] === vectorB[i]
    ) {
      matchSum += w;
    }
  }

  return weightSum > 0 ? matchSum / weightSum : 0;
}

/**
 * Calculates the total intra-group compatibility for a group.
 * The score is the sum of pairwise similarities between all 6 unique pairs of the 4 members.
 */
export function calculateGroupSimilarity(
  vectors: (string | null)[][],
  weights: number[] = [1.0, 1.0, 1.0, 1.0, 1.0]
): number {
  let totalSimilarity = 0;

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      totalSimilarity += calculatePairwiseSimilarity(vectors[i], vectors[j], weights);
    }
  }

  return totalSimilarity;
}
