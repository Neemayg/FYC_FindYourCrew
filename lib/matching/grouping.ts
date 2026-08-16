import { Candidate, GroupResult } from '@/types';
import { calculateGroupSimilarity } from './compatibility';

/**
 * Phase 1: Greedy Initialization.
 * Deterministically constructs groups of exactly 4 from the candidate cohort.
 */
export function greedyInitialization(
  candidates: Candidate[],
  weights: number[] = [1.0, 1.0, 1.0, 1.0, 1.0]
): GroupResult[] {
  // Sort candidates alphabetically by UUID to guarantee deterministic starting order
  let unmatched = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const groups: GroupResult[] = [];
  let groupIndex = 1;

  while (unmatched.length >= 4) {
    // Select the first unmatched candidate
    const p = unmatched[0];
    unmatched = unmatched.slice(1);

    const currentGroup: Candidate[] = [p];

    // Find 3 additional members sequentially, maximizing group compatibility at each step
    while (currentGroup.length < 4) {
      let bestCandidate: Candidate | null = null;
      let bestScore = -1;

      for (const candidate of unmatched) {
        // Calculate score if candidate is added
        const tempGroup = [...currentGroup, candidate];
        const score = calculateGroupSimilarity(
          tempGroup.map((m) => m.vector),
          weights
        );

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        } else if (score === bestScore && bestCandidate) {
          // Tie-breaker: Deterministic fallback to alphabetically lowest UUID
          if (candidate.id.localeCompare(bestCandidate.id) < 0) {
            bestCandidate = candidate;
          }
        }
      }

      if (bestCandidate) {
        currentGroup.push(bestCandidate);
        unmatched = unmatched.filter((m) => m.id !== bestCandidate!.id);
      } else {
        break;
      }
    }

    groups.push({
      groupCode: `AP-${String(groupIndex).padStart(2, '0')}`,
      members: currentGroup,
    });
    groupIndex++;
  }

  // If we have candidates left (e.g. rehearsal session with size < 4),
  // place all remaining candidates into a final group.
  if (unmatched.length > 0) {
    groups.push({
      groupCode: `AP-${String(groupIndex).padStart(2, '0')}`,
      members: unmatched,
    });
  }

  return groups;
}

/**
 * Phase 2: Local Search (Hill Climbing).
 * Evaluates 5,000 swap options to optimize total pairwise compatibility.
 */
export function optimizeGroups(
  groups: GroupResult[],
  iterations: number = 5000,
  prng: () => number,
  weights: number[] = [1.0, 1.0, 1.0, 1.0, 1.0]
): GroupResult[] {
  if (groups.length < 2) return groups;

  // Deep clone groups to prevent side effects during evaluations
  const optimized = groups.map((g) => ({
    groupCode: g.groupCode,
    members: [...g.members],
  }));

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Pick two random distinct groups using the seeded PRNG
    const idxX = Math.floor(prng() * optimized.length);
    let idxY = Math.floor(prng() * optimized.length);
    while (idxX === idxY) {
      idxY = Math.floor(prng() * optimized.length);
    }

    // 2. Pick a random member index (0 to 3) in each group using the PRNG
    const pIdxA = Math.floor(prng() * 4);
    const pIdxB = Math.floor(prng() * 4);

    const gX = optimized[idxX];
    const gY = optimized[idxY];

    const candA = gX.members[pIdxA];
    const candB = gY.members[pIdxB];

    // 3. Compute group similarity scores before swap
    const scoreXBefore = calculateGroupSimilarity(
      gX.members.map((m) => m.vector),
      weights
    );
    const scoreYBefore = calculateGroupSimilarity(
      gY.members.map((m) => m.vector),
      weights
    );
    const scoreBefore = scoreXBefore + scoreYBefore;

    // 4. Compute group similarity scores after swap
    const tempMembersX = [...gX.members];
    const tempMembersY = [...gY.members];
    tempMembersX[pIdxA] = candB;
    tempMembersY[pIdxB] = candA;

    const scoreXAfter = calculateGroupSimilarity(
      tempMembersX.map((m) => m.vector),
      weights
    );
    const scoreYAfter = calculateGroupSimilarity(
      tempMembersY.map((m) => m.vector),
      weights
    );
    const scoreAfter = scoreXAfter + scoreYAfter;

    // 5. Commit swap only if it strictly improves compatibility (Delta > 0)
    const delta = scoreAfter - scoreBefore;
    if (delta > 0) {
      gX.members[pIdxA] = candB;
      gY.members[pIdxB] = candA;
    }
  }

  return optimized;
}
