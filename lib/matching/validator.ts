import { Candidate, GroupResult } from '@/types';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates the matching results against core rules prior to database persistence.
 * Enforces size-4 constraints, standby exclusions, uniqueness, and cohort completeness.
 */
export function validateGroups(
  groups: GroupResult[],
  eligibleMatchedIds: Set<string>,
  standbyIds: Set<string>,
  isRehearsal: boolean = false
): ValidationResult {
  const matchedSet = new Set<string>();

  // 1. Verify Group Count equals matched_participants / 4 (or 1 if rehearsal and < 4)
  const Nc = eligibleMatchedIds.size;
  const expectedGroupCount = isRehearsal && Nc < 4 ? 1 : (Nc / 4);
  if (groups.length !== expectedGroupCount) {
    return {
      isValid: false,
      error: `Group count mismatch. Expected ${expectedGroupCount} groups, got ${groups.length}.`,
    };
  }

  for (const group of groups) {
    // 2. Every group must contain exactly 4 members (or between 1 and 4 if rehearsal)
    const minSize = isRehearsal ? 1 : 4;
    const maxSize = 4;
    if (group.members.length < minSize || group.members.length > maxSize) {
      return {
        isValid: false,
        error: `Invalid group size in group ${group.groupCode}. Expected size between ${minSize} and ${maxSize}, got ${group.members.length}.`,
      };
    }

    for (const member of group.members) {
      // 3. No participant appears in multiple groups (uniqueness check)
      if (matchedSet.has(member.id)) {
        return {
          isValid: false,
          error: `Duplicate participant detected: ${member.id} is mapped to multiple groups.`,
        };
      }
      matchedSet.add(member.id);

      // 4. No standby participant should appear in matched groups
      if (standbyIds.has(member.id)) {
        return {
          isValid: false,
          error: `Standby candidate violation: ${member.id} was placed on standby but appears in group ${group.groupCode}.`,
        };
      }

      // 5. Verify member is part of the eligible matched set
      if (!eligibleMatchedIds.has(member.id)) {
        return {
          isValid: false,
          error: `Eligibility boundary violation: Candidate ${member.id} in group ${group.groupCode} was not marked eligible for matching.`,
        };
      }

      // 6. Verify vector response count matches exactly 5 answers
      if (member.vector.length !== 5 || member.vector.some((ans) => ans === undefined)) {
        return {
          isValid: false,
          error: `Vector response count violation: Candidate ${member.id} has invalid answers vector.`,
        };
      }
    }
  }

  // 7. Verify all eligible matched participants are included
  for (const id of eligibleMatchedIds) {
    if (!matchedSet.has(id)) {
      return {
        isValid: false,
        error: `Omission error: Eligible candidate ${id} was omitted from all groups.`,
      };
    }
  }

  return { isValid: true };
}
