-- Run in Supabase SQL Editor. Safe to rerun; preserves all existing IoT data.
-- Supports Opspod catch-up: one provider/day, ordered by ID, with an ID cursor.
-- CONCURRENTLY keeps uploads available while the index is built. Run this file
-- by itself, outside a transaction block.
create index concurrently if not exists iot_data_source_date_id_idx
  on public.iot_data (data_source, run_date, id);
