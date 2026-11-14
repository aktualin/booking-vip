-- Remove loyalty e2e artifacts (local DB only), FK-safe order, one transaction.
BEGIN;

-- 1. Payments of the two test bookings (nothing references Payment)
DELETE FROM "Payment"
WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6'));

-- 2. Booking child rows (all ON DELETE RESTRICT)
DELETE FROM "BookingItem"   WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6'));
DELETE FROM "BookingAddOn"  WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6'));
DELETE FROM "Contact"       WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6'));
DELETE FROM "Traveler"      WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6'));
DELETE FROM "FlightDetails" WHERE "bookingId" IN (SELECT id FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6'));

-- 3. The test bookings themselves
DELETE FROM "Booking" WHERE code IN ('BV-PZ82W4','BV-V7KFF6');

-- 4. E2E vouchers: the two named fixtures + every RWD-* owned by the test user
DELETE FROM "PromoCode"
WHERE code IN ('RWD-AAAAAA','RWD-BBBBBB')
   OR id LIKE 'rwd:ZTysZOYPUIZ86Gf243KJUKP71kx2:%';

-- 5. Dependent user rows (cascade-safe: none exist, verified) then the test users
DELETE FROM "Review"           WHERE "userId" IN ('ZTysZOYPUIZ86Gf243KJUKP71kx2','aHpPLVWYMCVw2V8PcgawBbBhTW22','zASTlMMg7Kc3M9sviATlzMRCqCF3');
DELETE FROM "SavedCard"        WHERE "userId" IN ('ZTysZOYPUIZ86Gf243KJUKP71kx2','aHpPLVWYMCVw2V8PcgawBbBhTW22','zASTlMMg7Kc3M9sviATlzMRCqCF3');
DELETE FROM "PushSubscription" WHERE "userId" IN ('ZTysZOYPUIZ86Gf243KJUKP71kx2','aHpPLVWYMCVw2V8PcgawBbBhTW22','zASTlMMg7Kc3M9sviATlzMRCqCF3');
DELETE FROM "VisaApplication"  WHERE "userId" IN ('ZTysZOYPUIZ86Gf243KJUKP71kx2','aHpPLVWYMCVw2V8PcgawBbBhTW22','zASTlMMg7Kc3M9sviATlzMRCqCF3');
DELETE FROM "User"
WHERE id IN ('ZTysZOYPUIZ86Gf243KJUKP71kx2','aHpPLVWYMCVw2V8PcgawBbBhTW22','zASTlMMg7Kc3M9sviATlzMRCqCF3')
  AND email LIKE 'bv.loyalty.%@example.com';

COMMIT;