#!/bin/bash
set -e
cd /workspaces/shift-app/shift_app

ANON_KEY="sb_publishable_Px6BOsQjEiEtsHXULMt6SA_DwlJrW66"
SUPABASE_URL="https://iywhxmuzvincfmezijtv.supabase.co"
SKETCH_FILE="test_sketch.jpg"

if [ ! -f "$SKETCH_FILE" ]; then
  echo "לא מצאתי את $SKETCH_FILE בתיקייה הנוכחית (shift_app)."
  echo "גרור את תמונת השרטוט לתיקייה הזו ב-Explorer, ותקרא לה בדיוק test_sketch.jpg"
  exit 1
fi

echo "1. יוצר משתמש אנונימי לבדיקה בלבד..."
AUTH_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}')

ACCESS_TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
USER_ID=$(echo "$AUTH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('user') or {}).get('id',''))" 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ] || [ -z "$USER_ID" ]; then
  echo "❌ לא הצלחתי ליצור משתמש בדיקה. זו התגובה המדויקת מהשרת (תשלח לי את זה):"
  echo "$AUTH_RESPONSE"
  exit 1
fi

echo "   ✅ משתמש בדיקה נוצר: $USER_ID"

echo "2. מעלה את תמונת השרטוט ל-Storage..."
UPLOAD_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/storage/v1/object/renders/$USER_ID/test_sketch.jpg" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@$SKETCH_FILE")
echo "   תגובת ההעלאה: $UPLOAD_RESPONSE"

echo "3. קורא ל-analyze-sketch (זה עלול לקחת עד כמה עשרות שניות)..."
curl -s -X POST "$SUPABASE_URL/functions/v1/analyze-sketch" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sketchImagePath\": \"$USER_ID/test_sketch.jpg\"}" \
  -o /tmp/analyze_result.json

echo "=== התוצאה המלאה: ==="
python3 -m json.tool /tmp/analyze_result.json 2>/dev/null || cat /tmp/analyze_result.json