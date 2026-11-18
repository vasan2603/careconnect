-- Run once in Supabase SQL Editor for the existing CareConnect profiles table.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION public.careconnect_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.careconnect_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.careconnect_is_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name text,
  name text,
  specialty text,
  speciality text,
  qualifications text,
  experience integer,
  experience_years integer,
  consultation_fee numeric,
  clinic_address text,
  bio text,
  city text,
  status text NOT NULL DEFAULT 'pending'
);

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS speciality text,
  ADD COLUMN IF NOT EXISTS qualifications text,
  ADD COLUMN IF NOT EXISTS experience integer,
  ADD COLUMN IF NOT EXISTS experience_years integer,
  ADD COLUMN IF NOT EXISTS consultation_fee numeric,
  ADD COLUMN IF NOT EXISTS clinic_address text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS approval_status text
    GENERATED ALWAYS AS (status::text) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS careconnect_doctors_user_id_key
  ON public.doctors (user_id);

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.doctors TO anon, authenticated;
GRANT INSERT ON TABLE public.doctors TO authenticated;
GRANT UPDATE (user_id, full_name, name, specialty, speciality, qualifications, experience,
  experience_years, consultation_fee, clinic_address, bio, city, status)
  ON TABLE public.doctors TO authenticated;

DROP POLICY IF EXISTS careconnect_doctors_select_approved ON public.doctors;
CREATE POLICY careconnect_doctors_select_approved
  ON public.doctors FOR SELECT TO anon, authenticated
  USING (status = 'approved');

DROP POLICY IF EXISTS careconnect_doctors_select_own_or_admin ON public.doctors;
CREATE POLICY careconnect_doctors_select_own_or_admin
  ON public.doctors FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.careconnect_is_admin());

DROP POLICY IF EXISTS careconnect_doctors_insert_admin ON public.doctors;
CREATE POLICY careconnect_doctors_insert_admin
  ON public.doctors FOR INSERT TO authenticated
  WITH CHECK (public.careconnect_is_admin());

DROP POLICY IF EXISTS careconnect_doctors_update_own_or_admin ON public.doctors;
CREATE POLICY careconnect_doctors_update_own_or_admin
  ON public.doctors FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.careconnect_is_admin())
  WITH CHECK (auth.uid() = user_id OR public.careconnect_is_admin());

CREATE TABLE IF NOT EXISTS public.doctor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  available_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_duration integer NOT NULL DEFAULT 30
);

ALTER TABLE public.doctor_availability
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS available_date date,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS slot_duration integer DEFAULT 30;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'doctor_availability'
      AND column_name = 'date'
  ) THEN
    EXECUTE 'UPDATE public.doctor_availability
      SET available_date = "date"::date
      WHERE available_date IS NULL AND "date" IS NOT NULL';
  END IF;
END;
$$;

ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.doctor_availability TO anon, authenticated;
GRANT INSERT, DELETE ON TABLE public.doctor_availability TO authenticated;

DROP POLICY IF EXISTS careconnect_availability_select_approved ON public.doctor_availability;
CREATE POLICY careconnect_availability_select_approved
  ON public.doctor_availability FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.doctors d
      WHERE d.id = doctor_availability.doctor_id
        AND d.status = 'approved'
    )
  );

DROP POLICY IF EXISTS careconnect_availability_select_owner_or_admin ON public.doctor_availability;
CREATE POLICY careconnect_availability_select_owner_or_admin
  ON public.doctor_availability FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.doctors d
      WHERE d.id = doctor_availability.doctor_id
        AND (d.user_id = auth.uid() OR public.careconnect_is_admin())
    )
  );

DROP POLICY IF EXISTS careconnect_availability_insert_owner_or_admin ON public.doctor_availability;
CREATE POLICY careconnect_availability_insert_owner_or_admin
  ON public.doctor_availability FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.doctors d
      WHERE d.id = doctor_availability.doctor_id
        AND (d.user_id = auth.uid() OR public.careconnect_is_admin())
    )
  );

DROP POLICY IF EXISTS careconnect_availability_delete_owner_or_admin ON public.doctor_availability;
CREATE POLICY careconnect_availability_delete_owner_or_admin
  ON public.doctor_availability FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.doctors d
      WHERE d.id = doctor_availability.doctor_id
        AND (d.user_id = auth.uid() OR public.careconnect_is_admin())
    )
  );

DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.appointments
      ADD COLUMN IF NOT EXISTS patient_id uuid,
      ADD COLUMN IF NOT EXISTS doctor_id uuid,
      ADD COLUMN IF NOT EXISTS availability_id uuid,
      ADD COLUMN IF NOT EXISTS appointment_date date,
      ADD COLUMN IF NOT EXISTS slot_time time,
      ADD COLUMN IF NOT EXISTS reason text,
      ADD COLUMN IF NOT EXISTS status text DEFAULT ''pending''';

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'appointments'
        AND column_name = 'date'
    ) THEN
      EXECUTE 'UPDATE public.appointments
        SET appointment_date = "date"::date
        WHERE appointment_date IS NULL AND "date" IS NOT NULL';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'appointments'
        AND column_name = 'time'
    ) THEN
      EXECUTE 'UPDATE public.appointments
        SET slot_time = "time"::time
        WHERE slot_time IS NULL AND "time" IS NOT NULL';
    END IF;

    IF to_regclass('public.doctor_availability') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'doctor_availability'
          AND column_name = 'available_date'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'appointments'
          AND column_name = 'availability_id'
      )
    THEN
      EXECUTE 'UPDATE public.appointments a
        SET appointment_date = da.available_date
        FROM public.doctor_availability da
        WHERE a.appointment_date IS NULL
          AND a.availability_id = da.id';
    END IF;

    EXECUTE 'ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.appointments TO authenticated';
    EXECUTE 'REVOKE UPDATE ON TABLE public.appointments FROM authenticated';
    EXECUTE 'GRANT UPDATE (status) ON TABLE public.appointments TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS careconnect_appointments_select_patient_doctor_admin ON public.appointments';
    EXECUTE $policy$
      CREATE POLICY careconnect_appointments_select_patient_doctor_admin
      ON public.appointments FOR SELECT TO authenticated
      USING (
        patient_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.doctors d
          WHERE d.id = appointments.doctor_id AND d.user_id = auth.uid()
        )
        OR public.careconnect_is_admin()
      )
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS careconnect_appointments_insert_patient ON public.appointments';
    EXECUTE $policy$
      CREATE POLICY careconnect_appointments_insert_patient
      ON public.appointments FOR INSERT TO authenticated
      WITH CHECK (patient_id = auth.uid() AND status = 'pending')
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS careconnect_appointments_cancel_patient ON public.appointments';
    EXECUTE $policy$
      CREATE POLICY careconnect_appointments_cancel_patient
      ON public.appointments FOR UPDATE TO authenticated
      USING (patient_id = auth.uid() AND status IN ('pending', 'confirmed'))
      WITH CHECK (patient_id = auth.uid() AND status = 'cancelled')
    $policy$;
    EXECUTE 'DROP POLICY IF EXISTS careconnect_appointments_review_doctor ON public.appointments';
    EXECUTE $policy$
      CREATE POLICY careconnect_appointments_review_doctor
      ON public.appointments FOR UPDATE TO authenticated
      USING (
        status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.doctors d
          WHERE d.id = appointments.doctor_id AND d.user_id = auth.uid()
        )
      )
      WITH CHECK (
        status IN ('confirmed', 'rejected')
        AND EXISTS (
          SELECT 1 FROM public.doctors d
          WHERE d.id = appointments.doctor_id AND d.user_id = auth.uid()
        )
      )
    $policy$;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.doctor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text,
  full_name text NOT NULL,
  specialty text NOT NULL,
  qualifications text NOT NULL,
  experience integer,
  experience_years integer NOT NULL CHECK (experience_years >= 0),
  consultation_fee numeric NOT NULL CHECK (consultation_fee >= 0),
  clinic_address text NOT NULL,
  bio text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.doctor_applications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS qualifications text,
  ADD COLUMN IF NOT EXISTS experience integer,
  ADD COLUMN IF NOT EXISTS experience_years integer,
  ADD COLUMN IF NOT EXISTS consultation_fee numeric,
  ADD COLUMN IF NOT EXISTS clinic_address text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.doctor_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE public.doctor_applications TO authenticated;
REVOKE ALL ON TABLE public.doctor_applications FROM PUBLIC, anon;

DROP POLICY IF EXISTS careconnect_applications_select_own_or_admin ON public.doctor_applications;
CREATE POLICY careconnect_applications_select_own_or_admin
  ON public.doctor_applications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.careconnect_is_admin());

DROP POLICY IF EXISTS careconnect_applications_insert_own ON public.doctor_applications;
CREATE POLICY careconnect_applications_insert_own
  ON public.doctor_applications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS careconnect_applications_update_rejected ON public.doctor_applications;
CREATE POLICY careconnect_applications_update_rejected
  ON public.doctor_applications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'rejected')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS careconnect_applications_update_admin ON public.doctor_applications;
CREATE POLICY careconnect_applications_update_admin
  ON public.doctor_applications FOR UPDATE TO authenticated
  USING (public.careconnect_is_admin())
  WITH CHECK (public.careconnect_is_admin());

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON TABLE public.profiles TO authenticated;
REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (role) ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, date_of_birth, gender, city, address, avatar_url)
  ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS careconnect_profiles_select_own ON public.profiles;
CREATE POLICY careconnect_profiles_select_own
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.careconnect_is_admin());

DROP POLICY IF EXISTS careconnect_profiles_insert_own ON public.profiles;
CREATE POLICY careconnect_profiles_insert_own
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role IN ('patient', 'doctor_applicant')
  );

DROP POLICY IF EXISTS careconnect_profiles_update_own ON public.profiles;
CREATE POLICY careconnect_profiles_update_own
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.careconnect_set_profile_role(
  target_profile_id uuid,
  new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NOT public.careconnect_is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  IF new_role <> 'doctor' THEN
    RAISE EXCEPTION 'Unsupported profile role';
  END IF;

  UPDATE public.profiles
  SET role = new_role
  WHERE id = target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.careconnect_set_profile_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.careconnect_set_profile_role(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.careconnect_complete_profile(
  profile_full_name text,
  profile_phone text,
  profile_date_of_birth date,
  profile_gender text,
  profile_city text,
  profile_address text,
  requested_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF requested_role IS NULL OR requested_role NOT IN ('patient', 'doctor_applicant') THEN
    RAISE EXCEPTION 'Unsupported profile role';
  END IF;

  INSERT INTO public.profiles AS current_profile (
    id, full_name, phone, date_of_birth, gender, city, address, role
  )
  VALUES (
    current_user_id, profile_full_name, profile_phone, profile_date_of_birth,
    profile_gender, profile_city, profile_address, requested_role
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    date_of_birth = EXCLUDED.date_of_birth,
    gender = EXCLUDED.gender,
    city = EXCLUDED.city,
    address = EXCLUDED.address,
    role = CASE
      WHEN current_profile.role IN ('patient', 'doctor_applicant') THEN EXCLUDED.role
      ELSE current_profile.role
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.careconnect_complete_profile(text, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.careconnect_complete_profile(text, text, date, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
