/// Supabase connection configuration.
///
/// NOTE ON SECURITY: the values below are the Supabase *anon/public* key and
/// project URL. These are safe to ship inside a client app by design — they
/// are protected by Row Level Security (RLS) policies on the database side,
/// not by secrecy. See supabase/migrations/0001_init.sql for the RLS setup.
///
/// The Supabase *service_role* key (a real secret) must NEVER be placed here
/// or anywhere in this app. It is only used server-side, inside Supabase
/// Edge Functions (e.g. the future function that calls the Replicate API),
/// configured via `supabase secrets set` — never committed to the repo.
class SupabaseConfig {
  SupabaseConfig._();

  static const String url = 'https://iywhxmuzvincfmezijtv.supabase.co';
  static const String anonKey = 'sb_publishable_Px6BOsQjEiEtsHXULMt6SA_DwlJrW66';
}
