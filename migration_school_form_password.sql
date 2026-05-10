-- Add password column to cohorts table
ALTER TABLE cohorts
ADD COLUMN IF NOT EXISTS school_form_password TEXT DEFAULT '';

-- Create server-side password verification function
-- This keeps the actual password on the server and only returns true/false
CREATE OR REPLACE FUNCTION verify_school_form_password(
  p_cohort_id UUID,
  p_entered_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stored_password TEXT;
BEGIN
  SELECT school_form_password INTO v_stored_password
  FROM cohorts
  WHERE id = p_cohort_id;

  -- Return false if no password is set or cohort not found
  IF v_stored_password IS NULL OR TRIM(v_stored_password) = '' THEN
    RETURN FALSE;
  END IF;

  -- Return true only if passwords match exactly
  RETURN TRIM(v_stored_password) = TRIM(p_entered_password);
END;
$$;

-- Create function to check if a password is required
-- Returns true if cohort has a password set, false if not
-- Does NOT expose the actual password
CREATE OR REPLACE FUNCTION school_form_requires_password(p_cohort_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_password TEXT;
BEGIN
  SELECT school_form_password INTO v_password
  FROM cohorts
  WHERE id = p_cohort_id;

  RETURN (v_password IS NOT NULL AND TRIM(v_password) != '');
END;
$$;
