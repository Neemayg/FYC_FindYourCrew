# FYC — Find Your Crew: Product Specification

This document details the product definition and scope constraints for **FYC — Find Your Crew**, an interactive orientation-day application developed for the technical/student club **Appirates**.

---

## 1. Product Vision

Rather than receiving a static slide presentation about Appirates, students at orientation will actively experience the club's core values—**Connection, Collaboration, Curiosity, Problem Solving, Teamwork, and Building Together**—through an interactive, real-time cooperative game.

The basic premise is:
1. Students join by scanning a QR code projected on the main screen.
2. They authenticate using Google OAuth, register, and enter a waiting room.
3. Once the event begins, the admin controls the flow: 5 scenarios play sequentially on the main auditorium projector.
4. For each scenario, students use their mobile devices to choose their preferred response (A, B, C, or D) within a limited timeframe.
5. After the 5th scenario, the matching engine groups students of compatible answers into temporary teams of exactly 4.
6. Students receive a temporary group code (e.g., `AP-47`) and must physically find their matched peers in the auditorium.
7. Once they gather and verify their group by checking in, a private, temporary group chat unlocks on their phones.
8. The orientation concludes with an Appirates reveal and club pitch.

---

## 2. Problem Statement

Orientation events are traditionally passive. Large auditories of incoming students sit through repetitive slide decks, creating a disconnect between the club's values (action, coding, community) and the presentation style. Students leave with information but no new connections or real experience of what it means to build together in Appirates.

---

## 3. Core Objectives

* **Experiential Introduction:** Demonstrate Appirates' collaborative culture dynamically.
* **Frictionless Icebreaking:** Lower the social barrier for orientation attendees to meet at least three peers.
* **High Reliability:** Deliver smooth, real-time interactivity for an audience of 100 to 500+ simultaneous participants.

---

## 4. Scope and Feature Boundaries

### In Scope
* Single-session lifecycle: The application is optimized for a single orientation event.
* Google OAuth + basic profile registration.
* Real-time state synchronization driven by the Admin Control Room (admin advances states, clients react).
* Locking answers immediately on submission or state transition.
* Ephemeral group matching (maximum compatibility optimization).
* Self-service physical group verification (all 4 check in to activate group chat).
* Ephemeral group chat (active only during the orientation session).

### Out of Scope (Non-Goals)
* **No Permanent Profiles/Clubs:** FYC does not assign students to permanent club departments or build permanent psychological profiles. Groups are temporary vehicle for interaction.
* **No Personality Diagnosis:** Results are not framed as a "personality test" or diagnostic. There are no "right" or "wrong" answers, nor is one crew type better than another.
* **No Native Video Streaming on Client Phones:** Student devices must not download or play high-bandwidth videos. Video playback is handled entirely by the auditorium projector.
* **No Long-term Chat Platform:** The chat does not support file attachments, image uploads, search, or persistence past the current orientation activity.

---

## 5. Core Feature Matrix

| Feature | Description | Target User |
| :--- | :--- | :--- |
| **Google Authentication** | Secure Google sign-in to verify student email and prevent duplicate session entries. | Student |
| **Live Waiting Room** | Displays active participant counts and holds users until the activity starts. | Student |
| **Admin Control Room** | Dashboard to transition states, trigger questions, monitor answers, run matching, and troubleshoot. | Admin |
| **Synchronized State Engine** | Backend-driven system that pushes current state (e.g., Q1, Q2, Matching, Chat) to all devices. | Projector / Student |
| **Question Console** | Lightweight interface showing current options (A, B, C, D) and a response lock status. | Student |
| **Matching Engine** | Server-side algorithm maximizing overall group compatibility and creating clusters of 4. | System |
| **Discovery & Check-in** | Group code display screen and a check-in interface to verify physical cohort assembly. | Student |
| **Ephemeral Chat** | Real-time group chat channel for verified cohorts. | Student |
