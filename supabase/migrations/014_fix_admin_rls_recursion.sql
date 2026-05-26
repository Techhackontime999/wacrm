-- ============================================================
-- Fix infinite RLS recursion in admin policies.
--
 -- The original 013 migration defined SELECT/UPDATE policies
-- that queried `profiles` inside the policy expression, which
-- triggered RLS re-evaluation → infinite recursion.
--
-- Fix: use a SECURITY DEFINER helper function that bypasses RLS.
-- ============================================================

-- Create the helper function (idempotent)
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

-- Drop the broken recursive policies
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- Re-create using the SECURITY DEFINER helper
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE
  USING (public.is_admin());
