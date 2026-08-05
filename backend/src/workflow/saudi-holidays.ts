/**
 * Saudi public-holiday generator for a Gregorian year — fully offline.
 * Fixed civil days plus the Eid holidays located through the official
 * Umm al-Qura calendar (built into JS via Intl 'islamic-umalqura').
 *
 * Eid dates ultimately depend on moon sighting; generated dates follow the
 * Umm al-Qura reference calendar and can be adjusted by the admin.
 */

const hijriFormat = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

function hijri(date: Date): { month: number; day: number } {
  const parts = hijriFormat.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { month: get('month'), day: get('day') };
}

export interface GeneratedHoliday {
  date: Date;
  name: string;
}

/** Hijri (month, day) → holiday name; official Saudi Eid breaks. */
const HIJRI_HOLIDAYS: Record<string, string> = {
  '10-1': 'عيد الفطر / Eid al-Fitr',
  '10-2': 'عيد الفطر / Eid al-Fitr',
  '10-3': 'عيد الفطر / Eid al-Fitr',
  '12-9': 'يوم عرفة / Arafat Day',
  '12-10': 'عيد الأضحى / Eid al-Adha',
  '12-11': 'عيد الأضحى / Eid al-Adha',
  '12-12': 'عيد الأضحى / Eid al-Adha',
};

export function generateSaudiHolidays(year: number): GeneratedHoliday[] {
  const result: GeneratedHoliday[] = [
    { date: new Date(Date.UTC(year, 1, 22)), name: 'يوم التأسيس / Founding Day' },
    { date: new Date(Date.UTC(year, 8, 23)), name: 'اليوم الوطني / National Day' },
  ];

  const cursor = new Date(Date.UTC(year, 0, 1));
  while (cursor.getUTCFullYear() === year) {
    const { month, day } = hijri(cursor);
    const name = HIJRI_HOLIDAYS[`${month}-${day}`];
    if (name) result.push({ date: new Date(cursor), name });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}
