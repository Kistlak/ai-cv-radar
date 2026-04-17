-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE cvs ENABLE ROW LEVEL SECURITY;
ALTER TABLE searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_results ENABLE ROW LEVEL SECURITY;

-- profiles: users can only read/write their own row
CREATE POLICY "profiles: own row only"
  ON profiles FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- user_api_keys: users can only read/write their own row
CREATE POLICY "user_api_keys: own row only"
  ON user_api_keys FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- cvs: users can only read/write their own CVs
CREATE POLICY "cvs: own rows only"
  ON cvs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- searches: users can only read/write their own searches
CREATE POLICY "searches: own rows only"
  ON searches FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- job_results: users can access results for their own searches
CREATE POLICY "job_results: via search ownership"
  ON job_results FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM searches
      WHERE searches.id = job_results.search_id
        AND searches.user_id = auth.uid()
    )
  );

-- Supabase Storage bucket for CVs
-- Run this in the Supabase dashboard Storage section or via SQL:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('cvs', 'cvs', false);

-- Storage RLS: users can only access their own CV files
-- (folder structure: {user_id}/{filename})
CREATE POLICY "cv storage: own files only"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'cvs' AND
    (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'cvs' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
