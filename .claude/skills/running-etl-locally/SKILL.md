---
name: running-etl-locally
description: Run the ETL job locally with an interactive UI. Use when the user wants to "run ETL", "test ETL locally", "execute donations sync", or "load data from sources". Provides guided selection of mode, sources, and pipeline stages.
---

# Running ETL Locally

Guide the user through running the donations ETL locally with an interactive selection UI.

## Interactive Flow

Use the AskUserQuestion tool to gather all options in a single step:

```
Ask these questions together:

1. **Mode** (header: "Mode")
   - "Daily (incremental)" - Fetch only new data since last run
   - "Backfill (reload)" - Reload historical data for a date range

2. **Sources** (header: "Sources", multiSelect: true)
   - "Mercury" - Bank transactions
   - "PayPal" - PayPal donations
   - "Givebutter" - Givebutter donations
   - "All sources" - Run all three

3. **Pipeline Stage** (header: "Stage")
   - "Full pipeline" - Source → Staging → Final table (recommended)
   - "Source to Staging only" - Extract and load to staging, skip merge
   - "Staging to Final only" - Only run the merge step
```

## Execute Based on Selections

### Daily Mode (Incremental)

```bash
# All sources
bun run apps/runner/src/main.ts daily

# Specific sources
bun run apps/runner/src/main.ts daily --sources mercury,paypal
```

### Backfill Mode

For backfill, also ask for date range:

- From date (YYYY-MM-DD)
- To date (YYYY-MM-DD)
- Chunk size: day, week, or month (default: month)

```bash
# Full backfill
bun run apps/runner/src/main.ts backfill --from 2024-01-01 --to 2024-12-31

# With specific sources and chunk size
bun run apps/runner/src/main.ts backfill --from 2024-01-01 --to 2024-12-31 --sources mercury --chunk week
```

### Pipeline Stage Options

The ETL pipeline has two phases:

1. **Source → Staging**: Extract from APIs, write to GCS, load into staging tables
2. **Staging → Final**: MERGE staging data into canonical donations table

**Full pipeline**: Run the standard command (includes both phases)

**Source to Staging only** (`--skip-merge`):

```bash
# Daily: extract and load to staging, skip merge
bun run apps/runner/src/main.ts daily --sources mercury --skip-merge

# Backfill: extract date range to staging, skip merge
bun run apps/runner/src/main.ts backfill --from 2024-01-01 --to 2024-12-31 --skip-merge
```

**Staging to Final only** (`--merge-only`):

```bash
# Daily: just run merge from staging to final table
bun run apps/runner/src/main.ts daily --merge-only

# Backfill: just run merge (no date range required)
bun run apps/runner/src/main.ts backfill --merge-only
```

Note: `--skip-merge` and `--merge-only` are mutually exclusive and cannot be used together.

## Pre-flight Checks

Before running, verify:

```bash
# Check environment is configured
test -f .env && echo "✓ .env exists" || echo "✗ Missing .env file"

# Verify dependencies
bun --version
```

## Example Sessions

### Full Pipeline

User: "run the etl locally"

→ Ask questions with AskUserQuestion (all 3 questions at once)
→ User selects: Daily, Mercury + PayPal, Full pipeline
→ Run: `bun run apps/runner/src/main.ts daily --sources mercury,paypal`
→ Show output and summarize results

### Source to Staging Only

User: "run the etl locally"

→ User selects: Daily, Mercury, Source to Staging only
→ Run: `bun run apps/runner/src/main.ts daily --sources mercury --skip-merge`
→ Data is extracted and loaded to staging table, merge is skipped

### Staging to Final Only

User: "just merge the staging data"

→ Run: `bun run apps/runner/src/main.ts daily --merge-only`
→ Only the merge step runs, no extraction

## Post-Run Verification

After ETL completes successfully, verify the data loaded correctly:

### 1. Check ETL Run Metrics

Query the metrics from the latest run to see how many rows were loaded:

```bash
bq query --use_legacy_sql=false "
SELECT
  run_id,
  status,
  started_at,
  TO_JSON_STRING(metrics) as metrics
FROM donations_raw.etl_runs
ORDER BY started_at DESC
LIMIT 1"
```

The metrics JSON shows counts per source:

```json
{
  "sources": {
    "mercury": { "count": 3856, "durationMs": 308030 },
    "paypal": { "count": 8632, "durationMs": 42125 },
    "givebutter": { "count": 6289, "durationMs": 173676 }
  },
  "totalCount": 18777,
  "totalDurationMs": 348024
}
```

### 2. Verify Final Table Row Counts

Query the canonical donations table to see unique events per source:

```bash
bq query --use_legacy_sql=false "
SELECT source, COUNT(*) as row_count
FROM donations.events
GROUP BY source
ORDER BY source"
```

**Note**: The final table contains _deduplicated_ records. The count may be lower than what was loaded because:

- The MERGE step deduplicates by `(source, external_id)`
- Overlapping date ranges in backfills may load the same events multiple times
- Re-running ETL for the same period reprocesses existing events

### 3. Check Date Coverage

Verify the date range of data in the final table:

```bash
bq query --use_legacy_sql=false "
SELECT
  source,
  MIN(event_ts) as earliest,
  MAX(event_ts) as latest,
  COUNT(*) as total
FROM donations.events
GROUP BY source
ORDER BY source"
```

### 4. Verify Staging Data for a Run

To see what a specific run loaded (before deduplication):

```bash
# Replace RUN_ID with actual run_id from step 1
bq query --use_legacy_sql=false "
SELECT source, COUNT(*) as rows_loaded
FROM donations_raw.stg_events
WHERE run_id = 'RUN_ID'
GROUP BY source
ORDER BY source"
```

## Health Check

If something fails, suggest running health check first:

```bash
bun run apps/runner/src/main.ts health
```
