-- FYC — Find Your Crew: Automatic Admin Role Promotion Trigger
-- This migration creates a trigger on auth.users to automatically assign
-- the 'admin' role metadata to neemay.gupta1212@gmail.com upon user creation/insertion.

CREATE OR REPLACE FUNCTION public.handle_admin_role_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email = 'neemay.gupta1212@gmail.com' THEN
    NEW.raw_app_meta_data = coalesce(NEW.raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_assign_admin_role ON auth.users;
CREATE TRIGGER tr_assign_admin_role
BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_admin_role_assignment();
