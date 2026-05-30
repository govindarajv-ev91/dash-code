-- Fleet form data moved from Google Sheet into Supabase.
-- Ensure anon/authenticated roles can read (match fleet_data policies).

CREATE TABLE IF NOT EXISTS new_fleet_data (LIKE fleet_data INCLUDING ALL);

ALTER TABLE new_fleet_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "new_fleet_data_public_read" ON new_fleet_data;
CREATE POLICY "new_fleet_data_public_read"
  ON new_fleet_data FOR SELECT
  USING (true);
