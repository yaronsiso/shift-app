#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

cat > 'assets/translations/he.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "מחובר בהצלחה ל-Supabase",
    "not_connected": "אין חיבור לשרת",
    "placeholder_note": "שלד פרויקט (שלב 2) — מסכי האפליקציה האמיתיים יתווספו בשלבים הבאים"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "מה מעצבים היום?",
    "subtitle": "בחר את סוג החדר ומה תרצה לשנות בו",
    "room_section": "סוג החדר",
    "groups_section": "מה תרצה לעצב?",
    "select_room_first": "קודם בוחרים סוג חדר",
    "continue_button": "המשך לבחירת חומרים",
    "credits_free": "{} הדמיות חינם נותרו",
    "credits_subscription": "מנוי פעיל — {} הדמיות נותרו החודש",
    "credits_exhausted": "המכסה נגמרה"
  },
  "language": {
    "select": "בחר שפה",
    "he": "עברית",
    "ar": "ערבית",
    "ru": "רוסית",
    "en": "אנגלית"
  }
}
SHIFTEOF

cat > 'assets/translations/en.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "Connected to Supabase successfully",
    "not_connected": "No connection to the server",
    "placeholder_note": "Project scaffold (stage 2) — real app screens will be added in later stages"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "What are we designing today?",
    "subtitle": "Choose the room type and what you'd like to change",
    "room_section": "Room type",
    "groups_section": "What would you like to design?",
    "select_room_first": "Choose a room type first",
    "continue_button": "Continue to materials",
    "credits_free": "{} free renders left",
    "credits_subscription": "Active subscription — {} renders left this month",
    "credits_exhausted": "You've used your quota"
  },
  "language": {
    "select": "Select language",
    "he": "Hebrew",
    "ar": "Arabic",
    "ru": "Russian",
    "en": "English"
  }
}
SHIFTEOF

cat > 'assets/translations/ar.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "تم الاتصال بنجاح بـ Supabase",
    "not_connected": "لا يوجد اتصال بالخادم",
    "placeholder_note": "هيكل المشروع (المرحلة 2) — سيتم إضافة شاشات التطبيق الفعلية في المراحل القادمة"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "ماذا نصمم اليوم؟",
    "subtitle": "اختر نوع الغرفة وما تريد تغييره فيها",
    "room_section": "نوع الغرفة",
    "groups_section": "ماذا تريد أن تصمم؟",
    "select_room_first": "اختر نوع الغرفة أولاً",
    "continue_button": "متابعة لاختيار المواد",
    "credits_free": "{} صور مجانية متبقية",
    "credits_subscription": "اشتراك نشط — {} صور متبقية هذا الشهر",
    "credits_exhausted": "لقد استنفدت حصتك"
  },
  "language": {
    "select": "اختر اللغة",
    "he": "العبرية",
    "ar": "العربية",
    "ru": "الروسية",
    "en": "الإنجليزية"
  }
}
SHIFTEOF

cat > 'assets/translations/ru.json' << 'SHIFTEOF'
{
  "home": {
    "title": "SHIFT",
    "connected": "Успешно подключено к Supabase",
    "not_connected": "Нет подключения к серверу",
    "placeholder_note": "Каркас проекта (этап 2) — реальные экраны приложения будут добавлены на следующих этапах"
  },
  "home_screen": {
    "app_title": "SHIFT",
    "title": "Что оформляем сегодня?",
    "subtitle": "Выберите тип комнаты и что хотите изменить",
    "room_section": "Тип комнаты",
    "groups_section": "Что вы хотите изменить?",
    "select_room_first": "Сначала выберите тип комнаты",
    "continue_button": "Далее к выбору материалов",
    "credits_free": "Осталось бесплатных рендеров: {}",
    "credits_subscription": "Активная подписка — осталось {} в этом месяце",
    "credits_exhausted": "Лимит исчерпан"
  },
  "language": {
    "select": "Выберите язык",
    "he": "Иврит",
    "ar": "Арабский",
    "ru": "Русский",
    "en": "Английский"
  }
}
SHIFTEOF

echo "done"
