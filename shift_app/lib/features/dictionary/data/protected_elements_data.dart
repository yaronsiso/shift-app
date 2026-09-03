// נוצר אוטומטית מ-build_dict_data.py — אין לערוך ידנית.
// אלמנטים שחייבים להישמר במיסוך. ראו מסקנה 2 ב-claude/07.

import 'protected_element.dart';

const List<ProtectedElement> kProtectedElements = [
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'פתחי חלונות קיימים',
    labelEn: 'existing window openings',
    reason: 'מונע המצאת חלונות חדשים ומונע טשטוש הנוף — הכשל שזוהה בשלב 3',
  ),
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'דלתות כניסה ופנים',
    labelEn: 'existing doors',
    reason: 'המודל נוטה להזיז או למחוק דלתות',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'יחידת סינון אוויר',
    labelEn: 'MAMAD air filtration unit',
    reason: 'אלמנט חובה על פי תקנות. נמחק בכל ההרצות ובכל ההגדרות — רק מיסוך פותר',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'חלון הדף פלדתי',
    labelEn: 'MAMAD blast-resistant steel window',
    reason: 'אלמנט חובה על פי תקנות, לא ניתן להחלפה',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'דלת הדף פלדתית',
    labelEn: 'MAMAD blast-resistant steel door',
    reason: 'אלמנט חובה על פי תקנות, לא ניתן להחלפה',
  ),
  ProtectedElement(
    roomScopeHe: 'ממ"ד',
    labelHe: 'קירות בטון מזוין',
    labelEn: 'MAMAD reinforced concrete walls',
    reason: 'לא ניתן לפרק, ומוגבל בקידוח ובתלייה — לאמת מול פיקוד העורף',
  ),
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'מזגן מיני מרכזי / מפוצל',
    labelEn: 'air conditioning unit',
    reason: 'אופציונלי — המשתמש מסמן אם ברצונו לשמר',
  ),
  ProtectedElement(
    roomScopeHe: 'סלון',
    labelHe: 'טלוויזיה תלויה',
    labelEn: 'wall-mounted television',
    reason: 'נמחקה בבדיקת הסלון. אופציונלי לסימון ע"י המשתמש',
  ),
  ProtectedElement(
    roomScopeHe: 'כל החדרים',
    labelHe: 'דוד חשמל / מערכות גלויות',
    labelEn: 'water heater and exposed systems',
    reason: 'אופציונלי — לרוב המשתמש ירצה שיישארו',
  ),
];
