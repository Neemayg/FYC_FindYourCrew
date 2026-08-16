# FYC — Find Your Crew: Load & Scale Test Report

This report documents the performance results for different participant cohort sizes during orientation-day simulation.

---

## 1. Concurrency Benchmarks

### Rehearsal A: 100-User Cohort
* **Registration Time:** **NOT EXECUTED** (Inferred: ~450ms throughput under standard SQL transaction pool).
* **Answering Synchronization:** **NOT EXECUTED** (Inferred: ~300ms concurrent submissions).
* **Matching Duration:** **VERIFIED** (Executed locally: **4 milliseconds** using synthetic candidates).
* **Verification Latency:** **NOT EXECUTED** (Inferred: ~150ms trigger check).
* **Chat Throughput:** **NOT EXECUTED** (Inferred: ~200ms message delivery).

### Rehearsal B: 250-User Cohort
* **Registration Time:** **NOT EXECUTED** (Inferred: ~900ms throughput).
* **Answering Synchronization:** **NOT EXECUTED** (Inferred: ~600ms concurrent submissions).
* **Matching Duration:** **VERIFIED** (Executed locally: **11 milliseconds**).
* **Verification Latency:** **NOT EXECUTED** (Inferred: ~300ms trigger check).
* **Chat Throughput:** **NOT EXECUTED** (Inferred: ~400ms message delivery).

### Rehearsal C: 500-User Cohort (Stress Target)
* **Registration Time:** **NOT EXECUTED** (Inferred: ~1.8 seconds throughput).
* **Answering Synchronization:** **NOT EXECUTED** (Inferred: ~1.2 seconds concurrent submissions).
* **Matching Duration:** **VERIFIED** (Executed locally: **28 milliseconds**).
* **Verification Latency:** **NOT EXECUTED** (Inferred: ~600ms trigger check).
* **Chat Throughput:** **NOT EXECUTED** (Inferred: ~800ms message delivery).

---

## 2. Performance Bottlenecks & Analysis
* **Matching Engine Calculations:** Runs under 30 milliseconds even for 500 participants due to local execution optimization (cyrb128 FNV hashing + Mulberry32 + optimized swaps). This is well below the target of a few seconds.
* **Supabase API Rate Limits:** Under high concurrency (500+ users), concurrent anonymous WebSocket subscriptions may hit connection pool limits if the Supabase project is on a free-tier resource allocation.
* **Mitigation:** Orientation organizers must verify that the Supabase database instance is upgraded to a Pro Tier plan before event day to ensure connection pooling.
