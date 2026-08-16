# FYC — Find Your Crew: User Flow Specification

This document maps the user flows for the three primary interfaces of the **FYC — Find Your Crew** experience: the **Student Mobile App**, the **Admin Dashboard**, and the **Main Stage Projector**.

---

## 1. Global Activity States

The entire application moves through a single synchronized state machine. The admin advances this state machine, causing all connected student devices and the projector to update in real-time.

```mermaid
stateDiagram-v2
    [*] --> LOBBY : Session Created
    LOBBY --> QUESTION_1 : Admin Starts Activity
    QUESTION_1 --> QUESTION_2 : Admin Next
    QUESTION_2 --> QUESTION_3 : Admin Next
    QUESTION_3 --> QUESTION_4 : Admin Next
    QUESTION_4 --> QUESTION_5 : Admin Next
    QUESTION_5 --> MATCHING : Admin Triggers Matching
    MATCHING --> GROUP_REVEAL : Matching Engine Finished
    GROUP_REVEAL --> GROUP_CHAT : Verification Completed
    GROUP_CHAT --> COMPLETED : Admin Ends Session
    COMPLETED --> [*]
```

---

## 2. Student Flow

The student experiences FYC entirely on their mobile browser after scanning a QR code.

```mermaid
graph TD
    A[Scan QR Code] --> B[Landing Page]
    B --> C{Authenticated?}
    C -- No --> D[Google OAuth Sign-In]
    D --> E[Registration Form]
    C -- Yes --> E
    E --> F[Waiting Room / Lobby]
    F --> G{Activity Starts?}
    G -- Wait for Admin --> F
    G -- Yes --> H[Read Scenario on Projector / Wait]
    H --> I[Options A, B, C, D Displayed on Phone]
    I --> J[Select Option & Submit]
    J --> K[Lock Response Screen]
    K --> L{More Questions?}
    L -- Yes --> H
    L -- No --> M[Matching Screen / Waiting for Matching]
    M --> N[Receive Group Code e.g., AP-47]
    N --> O[Physical Search for Crew Members]
    O --> P[Check-in Verification Screen]
    P --> Q{All 4 Members Checked in?}
    Q -- No --> P
    Q -- Yes --> R[Unlock Group Chat]
    R --> S[Group Chat Active]
    S --> T[Activity Ends / Pitch Presentation]
```

---

## 3. Admin Flow

The admin has a control dashboard to drive the state machine and handle live issues.

```mermaid
graph TD
    A[Admin Login] --> B[Admin Dashboard]
    B --> C[Monitor Registrations & Wait Status]
    C --> D[Click 'Start Activity' -> State: QUESTION_1]
    D --> E[Play Scenario Video on Projector]
    E --> F[Open Question for Submissions]
    F --> G[Monitor Live Answer Counts]
    G --> H[Click 'Lock Responses' -> Close Submissions]
    H --> I{All 5 Scenarios Completed?}
    I -- No --> J[Click 'Next Question' -> Next State]
    J --> E
    I -- Yes --> K[Click 'Trigger Match' -> Runs Engine]
    K --> L[View Matching Progress & Status]
    L --> M[Click 'Reveal Groups' -> Group Codes Pushed]
    M --> N[Monitor Physical Verification Progress]
    N --> O[Click 'Enable Chat' -> ephemerality starts]
    O --> P[Oversee Activity Finish / Exceptions]
    P --> Q[Click 'End Session' -> Show Pitch Reveal]
```

---

## 4. Projector Flow

The projector screen runs on a dedicated machine connected to the auditorium's display system. It acts as the visual focus of the event.

```mermaid
graph TD
    A[Projector Client Connected] --> B[Display Welcome Screen & Join QR Code]
    B --> C[Show Live Count of Joined Students]
    C --> D{Admin Starts Q1?}
    D -- No --> C
    D -- Yes --> E[Play Scenario 1 Video]
    E --> F[Show Question 1 & Answer Distribution Stats]
    F --> G{Admin Next?}
    G -- Yes --> H[Play Scenario 2 Video]
    H --> I[Show Question 2 Options & Timer]
    I --> J[Repeat for Q3, Q4, Q5]
    J --> K[Show Matching Animation & Compatibility Recap]
    K --> L[Show Group Code Assembly Map / Instructions]
    L --> M[Show Real-Time Progress: Joined vs. Verified Crews]
    M --> N[Show Appirates Introduction Slides & Pitch]
```

---

## 5. Group Verification & Chat Flow

Students must physically gather to confirm their group of 4.

```mermaid
sequenceDiagram
    autonumber
    actor S1 as Member 1 (AP-47)
    actor S2 as Member 2 (AP-47)
    actor S3 as Member 3 (AP-47)
    actor S4 as Member 4 (AP-47)
    participant DB as Backend Database

    Note over S1,S4: Match Completed. Group code AP-47 displays.
    S1->>DB: Scan or click "Arrived at Crew"
    DB-->>S1: Status: 1/4 Verified
    S2->>DB: Scan or click "Arrived at Crew"
    DB-->>S1: Status: 2/4 Verified
    DB-->>S2: Status: 2/4 Verified
    S3->>DB: Scan or click "Arrived at Crew"
    S4->>DB: Scan or click "Arrived at Crew"
    Note over DB: All 4 members verified for AP-47
    DB->>S1: Unlock Group Chat
    DB->>S2: Unlock Group Chat
    DB->>S3: Unlock Group Chat
    DB->>S4: Unlock Group Chat
    Note over S1,S4: Chat active. Members can message each other.
```
