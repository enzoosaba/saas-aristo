ALTER TABLE aristo.records
  ADD CONSTRAINT records_value_within_target
  CHECK (value >= 0 AND target > 0 AND value <= target);
