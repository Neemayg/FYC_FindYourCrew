// FYC — Find Your Crew: Domain Types

export type ActivitySessionStatus =
  | 'LOBBY'
  | 'QUESTION_1'
  | 'QUESTION_2'
  | 'QUESTION_3'
  | 'QUESTION_4'
  | 'QUESTION_5'
  | 'MATCHING'
  | 'GROUP_REVEAL'
  | 'GROUP_CHAT'
  | 'COMPLETED'
  | 'ARCHIVED';

export type ParticipantEligibilityStatus =
  | 'REGISTERED'
  | 'ELIGIBLE'
  | 'STANDBY'
  | 'INACTIVE';

export interface ActivitySession {
  id: string;
  name: string;
  status: ActivitySessionStatus;
  currentQuestionId: number | null;
  timerStartedAt: string | null; // ISO Date String
  timerDuration: number | null; // duration in seconds
  createdAt: string;
}

export interface Participant {
  id: string; // references auth.users(id)
  fullName: string;
  email: string;
  phone: string;
  branch: string;
  year: number;
  consentStatus: boolean;
  createdAt: string;
}

export interface SessionParticipant {
  id: string;
  sessionId: string;
  participantId: string;
  status: ParticipantEligibilityStatus;
  createdAt: string;
}

export interface Question {
  id: number;
  questionNumber: number;
  questionText: string;
  weight: number;
}

export interface Option {
  id: string;
  questionId: number;
  optionLetter: 'A' | 'B' | 'C' | 'D';
  optionText: string;
}

export interface Response {
  id: string;
  sessionId: string;
  participantId: string;
  questionId: number;
  selectedOption: 'A' | 'B' | 'C' | 'D';
  submittedAt: string;
}

export interface Group {
  id: string;
  sessionId: string;
  groupCode: string;
  isVerified: boolean;
  chatEnabled: boolean;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  participantId: string;
  verifiedAt: string | null; // Check-in timestamp, null if not checked in
}

export interface ChatMessage {
  id: string;
  groupId: string;
  senderId: string;
  messageText: string;
  isReported: boolean;
  createdAt: string;
}

export interface Candidate {
  id: string;
  vector: (string | null)[];
}

export interface GroupResult {
  groupCode: string;
  members: Candidate[];
}
