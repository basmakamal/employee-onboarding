import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riyada_hr/app/i18n/strings.dart';
import 'package:riyada_hr/app/theme/tokens.dart';

void main() {
  group('status colour is semantic and declared once', () {
    test('completed states are success, holds are warning, dead states danger', () {
      const c = AppColors.light;
      expect(c.forStatus('DONE'), c.success);
      expect(c.forStatus('APPROVED'), c.success);
      expect(c.forStatus('ACTIVE'), c.success);
      expect(c.forStatus('ON_HOLD'), c.warning);
      expect(c.forStatus('EXPIRED'), c.danger);
      expect(c.forStatus('REJECTED'), c.danger);
      // Anything in flight reads as primary rather than falling through blank.
      expect(c.forStatus('PENDING'), c.primary);
      expect(c.forStatus('AWAITING_FORM'), c.primary);
    });
  });

  group('strings', () {
    test('Arabic is the default and both locales resolve every machine', () {
      const ar = S(Locale('ar'));
      const en = S(Locale('en'));
      expect(ar.isAr, isTrue);
      expect(ar.kind('GOSI'), 'التأمينات الاجتماعية');
      expect(en.kind('GOSI'), 'GOSI');
      expect(ar.status('ON_HOLD'), 'معلّق');
      expect(en.status('ON_HOLD'), 'On hold');
    });

    test('unknown enum values fall back to the raw key, never blank', () {
      const s = S(Locale('en'));
      expect(s.status('SOME_NEW_STATUS'), 'SOME_NEW_STATUS');
      expect(s.kind('NEW_MACHINE'), 'NEW_MACHINE');
      expect(s.holdReason('NEW_REASON'), 'NEW_REASON');
    });
  });
}
