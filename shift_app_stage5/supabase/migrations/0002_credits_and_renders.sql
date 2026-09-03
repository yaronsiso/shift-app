-- SHIFT — מיגרציה 0002: קרדיטים, מנויים, ומעקב אחרי הדמיות.
--
-- להריץ ב-Supabase Dashboard → SQL Editor → New query → Run.
-- בטוח להרצה חוזרת (idempotent).
--
-- מה זה מוסיף מעבר ל-0001:
--   1. שדות ל-renders שמתעדים את הפרומפט בפועל ואת מצב העבודה.
--   2. פונקציה אטומית לצריכת קרדיט — הלב של מנגנון החיוב.
--   3. פונקציית החזר קרדיט לכישלונות.

-- ---------------------------------------------------------------------------
-- הרחבת טבלת renders
-- ---------------------------------------------------------------------------
alter table public.renders
  add column if not exists room_type text,
  add column if not exists prompt text,
  add column if not exists negative_prompt text,
  add column if not exists prompt_strength numeric(3,2),
  add column if not exists replicate_prediction_id text,
  add column if not exists status text not null default 'pending',
  add column if not exists error_message text,
  add column if not exists credit_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'renders_status_check'
  ) then
    alter table public.renders
      add constraint renders_status_check
      check (status in ('pending', 'processing', 'succeeded', 'failed', 'refunded'));
  end if;
end $$;

create index if not exists renders_user_created_idx
  on public.renders (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- כמה הדמיות חינם מקבל משתמש חדש. לפי מסמך התמחור: 3.
-- ---------------------------------------------------------------------------
create or replace function public.free_render_quota()
returns integer language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- בדיקת זכאות בלבד (בלי לצרוך) — לתצוגה באפליקציה.
-- ---------------------------------------------------------------------------
create or replace function public.render_eligibility()
returns table (
  allowed boolean,
  reason text,
  free_remaining integer,
  subscription_tier text,
  subscription_active boolean
)
language plpgsql
security definer set search_path = public
as $$
declare
  p public.profiles%rowtype;
  active boolean;
  remaining integer;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then
    return query select false, 'no_profile', 0, 'free', false;
    return;
  end if;

  active := p.subscription_tier <> 'free'
        and (p.subscription_expires_at is null
             or p.subscription_expires_at > now());

  remaining := greatest(public.free_render_quota() - p.free_credits_used, 0);

  if active then
    return query select true, 'subscription', remaining, p.subscription_tier, true;
  elsif remaining > 0 then
    return query select true, 'free_credit', remaining, p.subscription_tier, false;
  else
    return query select false, 'quota_exhausted', 0, p.subscription_tier, false;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- צריכת קרדיט — אטומית. **זו הנקודה היחידה שבה נספרים קרדיטים.**
--
-- ה-`for update` נועל את שורת הפרופיל עד סוף הטרנזקציה. בלעדיו, משתמש
-- שישגר עשר בקשות במקביל עם קרדיט אחד שנותר יקבל עשר הדמיות: כל הבקשות
-- היו קוראות את אותו ערך לפני שאף אחת מהן הספיקה לעדכן אותו.
--
-- הפונקציה `security definer` — היא רצה בהרשאות הבעלים ולכן יכולה לעדכן
-- את הפרופיל, אבל היא פועלת אך ורק על `auth.uid()` של הקורא.
-- ---------------------------------------------------------------------------
create or replace function public.consume_render_credit()
returns table (allowed boolean, reason text, free_remaining integer)
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  active boolean;
  remaining integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into p from public.profiles where id = uid for update;
  if not found then
    return query select false, 'no_profile', 0;
    return;
  end if;

  active := p.subscription_tier <> 'free'
        and (p.subscription_expires_at is null
             or p.subscription_expires_at > now());

  -- מנוי פעיל: אין ספירה, לא נוגעים במונה החינמי.
  if active then
    return query select true, 'subscription',
      greatest(public.free_render_quota() - p.free_credits_used, 0);
    return;
  end if;

  remaining := public.free_render_quota() - p.free_credits_used;
  if remaining <= 0 then
    return query select false, 'quota_exhausted', 0;
    return;
  end if;

  update public.profiles
    set free_credits_used = free_credits_used + 1
    where id = uid;

  return query select true, 'free_credit', remaining - 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- החזר קרדיט — כשההדמיה נכשלה ולא באשמת המשתמש.
-- לא יורד מתחת לאפס, ולא מחזיר למנוי (ממנו לא נגבה קרדיט מלכתחילה).
-- ---------------------------------------------------------------------------
create or replace function public.refund_render_credit(p_render_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.renders%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into r from public.renders
    where id = p_render_id and user_id = uid for update;
  if not found then return false; end if;

  -- מחזירים רק על הדמיה שנכשלה, ורק אם נגבה עליה קרדיט חינמי.
  if r.status <> 'failed' or r.credit_source is distinct from 'free_credit' then
    return false;
  end if;

  update public.profiles
    set free_credits_used = greatest(free_credits_used - 1, 0)
    where id = uid;

  update public.renders set status = 'refunded' where id = p_render_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- הרשאות: המשתמש המחובר רשאי לקרוא לפונקציות האלה, אבל **אין לו הרשאת
-- update ישירה** על השדות הרגישים — הוא חייב לעבור דרכן.
-- ---------------------------------------------------------------------------
revoke all on function public.consume_render_credit() from public;
revoke all on function public.refund_render_credit(uuid) from public;
revoke all on function public.render_eligibility() from public;

grant execute on function public.consume_render_credit() to authenticated;
grant execute on function public.refund_render_credit(uuid) to authenticated;
grant execute on function public.render_eligibility() to authenticated;

-- ---------------------------------------------------------------------------
-- סגירת פרצה מ-0001: המדיניות שם אפשרה למשתמש לעדכן את הפרופיל שלו —
-- כלומר גם לאפס לעצמו את free_credits_used או להעניק לעצמו מנוי.
-- מחליפים אותה במדיניות שמתירה עדכון רק של שדות לא-רגישים.
-- ---------------------------------------------------------------------------
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can update their own profile (safe fields only)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.protect_billing_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- כשהעדכון מגיע מהאפליקציה (תפקיד authenticated), שדות החיוב נעולים.
  -- קריאות מהשרת (service_role) ומהפונקציות שלמעלה עוברות.
  if current_setting('role', true) = 'authenticated' then
    new.free_credits_used       := old.free_credits_used;
    new.subscription_tier       := old.subscription_tier;
    new.subscription_expires_at := old.subscription_expires_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_billing on public.profiles;
create trigger profiles_protect_billing
  before update on public.profiles
  for each row execute procedure public.protect_billing_fields();
