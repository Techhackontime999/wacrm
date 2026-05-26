-- ============================================================
-- Admin approval system — require admin approval before users
-- can access the dashboard.
--
-- Adds:
--   1. `is_approved` column to profiles (default false)
--   2. RLS policy so admin users can SELECT/UPDATE all profiles
--   3. Updated handle_new_user() trigger that:
--       - Makes the first-ever user an admin with auto-approval
--       - Sets subsequent new users to is_approved = false
-- ============================================================

-- ============================================================
-- 1. Add is_approved column
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN
    NOT NULL
    DEFAULT FALSE;

-- ============================================================
-- 2. Helper function: check if the current user is an admin.
--    Uses SECURITY DEFINER to bypass RLS and avoid infinite
--    recursion when called from an RLS policy.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================
-- 3. RLS: admins can view & update every profile row
-- ============================================================

-- Admin SELECT — allows admins to list all users in the admin panel
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT
  USING (public.is_admin());

-- Admin UPDATE — allows admins to approve/reject other users
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE
  USING (public.is_admin());

-- ============================================================
-- 4. Update handle_new_user() trigger
--    First user → admin + auto-approved
--    Subsequent users → regular user, pending approval
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO admin_count
  FROM public.profiles
  WHERE role = 'admin';

  IF admin_count = 0 THEN
    -- First user ever — make them admin and auto-approve
    INSERT INTO public.profiles (user_id, full_name, email, role, is_approved)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      NEW.email,
      'admin',
      TRUE
    );
  ELSE
    -- Subsequent users — regular role, pending approval
    INSERT INTO public.profiles (user_id, full_name, email, role, is_approved)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      NEW.email,
      'user',
      FALSE
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
