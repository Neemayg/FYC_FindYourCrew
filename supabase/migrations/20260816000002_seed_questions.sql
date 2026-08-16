-- FYC — Find Your Crew: Seed Questions and Options Migration

-- Clear existing data if present to ensure clean seed execution
DELETE FROM public.options;
DELETE FROM public.questions;

-- 1. Insert Questions (Scenario 1 to Scenario 5)
-- We include dummy CDN placeholders for scenario_video URLs to run on the projector
INSERT INTO public.questions (id, question_number, question_text, weight) VALUES
(1, 1, 'Scenario 1 — The Lost Node: A critical server crashes during the Appirates Hackathon. How do you respond?', 1.00),
(2, 2, 'Scenario 2 — The UI/UX Paradox: The user interface is too complex for orientation students. How do you refine it?', 1.00),
(3, 3, 'Scenario 3 — API Congestion: Mass orientation registration causes API timeouts. What is the bottleneck fix?', 1.00),
(4, 4, 'Scenario 4 — The Key Leak: A developer accidentally commits a database private key to a public repo. How do you handle it?', 1.00),
(5, 5, 'Scenario 5 — Crew Friction: Two core builders in your crew disagree on system architecture. How do you resolve it?', 1.00);

-- Reset Serial PK sequence for subsequent inserts
SELECT setval('questions_id_seq', 5, true);

-- 2. Insert Options for Question 1
INSERT INTO public.options (question_id, option_letter, option_text) VALUES
(1, 'A', 'Immediate Hotpatch: Roll back changes and apply a quick fix locally.'),
(1, 'B', 'Log Analyzer: Study diagnostic log traces to find the exact root cause first.'),
(1, 'C', 'Load Balancer: Provision a backup failover server to absorb incoming traffic.'),
(1, 'D', 'Crisis Meeting: Pull the crew together to plan a collaborative strategy.');

-- 3. Insert Options for Question 2
INSERT INTO public.options (question_id, option_letter, option_text) VALUES
(2, 'A', 'Simplification: Wipe the complex screens and design a clean one-click interface.'),
(2, 'B', 'User Interview: Sit down with students to observe exactly where they face friction.'),
(2, 'C', 'Guide Prompts: Add tooltips and step-by-step onboarding tool walkthroughs.'),
(2, 'D', 'Design Review: Host a visual crit with Appirates UI leads to redesign components.');

-- 4. Insert Options for Question 3
INSERT INTO public.options (question_id, option_letter, option_text) VALUES
(3, 'A', 'Database Tuning: Add indexes to response queries and scale read replicas.'),
(3, 'B', 'API Gateway Caching: Cache session lookups to bypass Postgres queries entirely.'),
(3, 'C', 'Rate Limiter: Restrict submission rates and queues to throttle load safely.'),
(3, 'D', 'Queue Worker: Store responses in Redis and process them asynchronously.');

-- 5. Insert Options for Question 4
INSERT INTO public.options (question_id, option_letter, option_text) VALUES
(4, 'A', 'Key Rotation: Revoke credentials instantly and issue new certificates.'),
(4, 'B', 'Git Purge: Use BFG Repo-Cleaner or git-filter-repo to wipe commit logs.'),
(4, 'C', 'Audit Logs: Scan audit trails to verify if the key was hijacked by bots.'),
(4, 'D', 'Security Briefing: Run a post-mortem to educate the crew on secrets managers.');

-- 6. Insert Options for Question 5
INSERT INTO public.options (question_id, option_letter, option_text) VALUES
(5, 'A', 'Lead Decision: Decided by the architect to keep development moving quickly.'),
(5, 'B', 'Prototype Race: Have both builders code quick mockups and compare performance.'),
(5, 'C', 'Compromise Design: Merge the two patterns into a modular hybrid architecture.'),
(5, 'D', 'External Arbitrator: Ask Appirates technical lead to review and decide.');
