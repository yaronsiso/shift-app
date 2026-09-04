// נוצר אוטומטית מ-build_dict_data.py — אין לערוך ידנית.

import 'room_type.dart';

const List<RoomType> kRoomTypes = [
  RoomType(
    code: 'living',
    labelHe: 'סלון',
    labelEn: 'Living room',
    isExterior: false,
  ),
  RoomType(
    code: 'bedroom',
    labelHe: 'חדר שינה',
    labelEn: 'Bedroom',
    isExterior: false,
  ),
  RoomType(
    code: 'mamad',
    labelHe: 'ממ"ד',
    labelEn: 'MAMAD (safe room)',
    isExterior: false,
  ),
  RoomType(
    code: 'kids',
    labelHe: 'חדר ילדים',
    labelEn: 'Kids room',
    isExterior: false,
  ),
  RoomType(
    code: 'kitchen',
    labelHe: 'מטבח',
    labelEn: 'Kitchen',
    isExterior: false,
  ),
  RoomType(
    code: 'bathroom',
    labelHe: 'חדר רחצה',
    labelEn: 'Bathroom',
    isExterior: false,
  ),
  RoomType(
    code: 'office',
    labelHe: 'משרד / חדר עבודה',
    labelEn: 'Home office',
    isExterior: false,
  ),
  RoomType(
    code: 'balcony',
    labelHe: 'מרפסת',
    labelEn: 'Balcony / terrace',
    isExterior: false,
  ),
  RoomType(
    code: 'facade',
    labelHe: 'חזית הבית',
    labelEn: 'House facade',
    isExterior: true,
  ),
  RoomType(
    code: 'yard',
    labelHe: 'חצר וגינה',
    labelEn: 'Yard & garden',
    isExterior: true,
  ),
  // ---------------- חדרים נוספים (סשן 10, בקשת ירון) ----------------
  RoomType(
    code: 'dining',
    labelHe: 'פינת אוכל / חדר אוכל',
    labelEn: 'Dining area',
    isExterior: false,
  ),
  RoomType(
    code: 'hallway',
    labelHe: 'מסדרון',
    labelEn: 'Hallway',
    isExterior: false,
  ),
  RoomType(
    code: 'wc',
    labelHe: 'שירותים',
    labelEn: 'Powder room (WC)',
    isExterior: false,
  ),
  RoomType(
    code: 'closet_room',
    labelHe: 'חדר ארונות',
    labelEn: 'Walk-in closet',
    isExterior: false,
  ),
  RoomType(
    code: 'rental_unit',
    labelHe: 'יחידת דיור',
    labelEn: 'Rental unit / studio',
    isExterior: false,
  ),
  RoomType(
    code: 'whole_house',
    labelHe: 'הבית כולו',
    labelEn: 'Whole house',
    isExterior: false,
  ),
];
